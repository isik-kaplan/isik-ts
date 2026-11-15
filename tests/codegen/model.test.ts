// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { generateClient } from '../../src/codegen'
import { camel, modelOf, parentOf } from '../../src/codegen/model'

const ok = { '200': { description: '' } }
const doc = (paths: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  openapi: '3.0.3',
  paths,
  ...extra,
})
const names = (paths: Record<string, unknown>, stripPrefix?: string) =>
  modelOf(doc(paths), stripPrefix).resources.map((r) => [r.name, r.members.map((m) => m.name)])

describe('reading a document', () => {
  it('refuses what is not an OpenAPI document', () => {
    for (const value of [null, [], 'x', {}, { paths: [] }]) {
      expect(() => generateClient(value)).toThrow('codegen: the document has no `paths` - is it an OpenAPI document?')
    }
  })

  it('refuses an unknown key rule and a reference that does not resolve', () => {
    expect(() => generateClient(doc({}), { keys: 'some' as never })).toThrow(
      'codegen: keys must be every-write, declared or minted, not "some"'
    )
    const broken = doc({ '/a/': { get: { parameters: [{ $ref: '#/components/parameters/Nope' }], responses: ok } } })
    expect(() => generateClient(broken)).toThrow('codegen: #/components/parameters/Nope does not resolve')
  })

  it('makes an empty client of no paths', () => {
    expect(modelOf(doc({})).resources).toEqual([])
    expect(generateClient(doc({})).code).toContain('  return {\n  }')
  })

  it('follows references to path items and escaped pointers, and leaves outside ones alone', () => {
    const model = modelOf(
      doc(
        { '/a/': { $ref: '#/x/a~1b~0c' } },
        { x: { 'a/b~c': { get: { parameters: [{ $ref: 'other.yml#/P' }, 'junk'], responses: ok } } } }
      )
    )
    expect(model.resources[0].members[0].operation).toMatchObject({ path: '/a/', method: 'get', query: null })
  })

  it("lets an operation's parameter replace the path item's, and reads headers under any case", () => {
    const model = modelOf(
      doc({
        '/a/{id}/': {
          parameters: [
            { name: 'id', in: 'path', required: true },
            { name: 'q', in: 'query', required: true },
          ],
          patch: {
            parameters: [
              { name: 'q', in: 'query' },
              { name: 'if-match', in: 'header' },
              { name: 'IDEMPOTENCY-KEY', in: 'header' },
              { name: 'X-A', in: 'header' },
            ],
            requestBody: {},
            responses: ok,
          },
        },
      })
    )
    expect(model.resources[0].members[0].operation).toEqual({
      path: '/a/{id}/',
      method: 'patch',
      pathParameters: ['id'],
      query: { required: false },
      headers: { names: ['X-A'], required: false },
      etag: { name: 'if-match', required: false },
      declaresKey: { name: 'IDEMPOTENCY-KEY' },
      body: true,
    })
  })

  it('names resources after what is left of the path, keeping each one segment of its own', () => {
    expect(names({ '/api/v0/a-b/': { get: {} }, '/api/v0/c_d/{id}/': { get: {} } })).toEqual([
      ['aB', ['get']],
      ['cD', ['get']],
    ])
    expect(names({ '/only/': { get: {} } })).toEqual([['only', ['get']]])
    expect(names({ '/x/{id}/': { get: {} } })).toEqual([['root', ['get']]])
    expect(names({ '/x/{id}/': { get: {} }, '/y/': { get: {} } })).toEqual([
      ['x', ['get']],
      ['y', ['get']],
    ])
    expect(names({ '/{id}/': { get: {} } })).toEqual([['root', ['get']]])
    expect(names({ '/v0/a/': { get: {} }, '/v1/b/': { get: {} } })).toEqual([
      ['v0A', ['get']],
      ['v1B', ['get']],
    ])
    expect(names({ '/v0/a/': { get: {} } }, '/v0/a/')).toEqual([['root', ['get']]])
    expect(names({ '/v0/a/': { get: {} } }, '/nope/')).toEqual([['v0A', ['get']]])
    // A shared prefix may hold a parameter: the client fills it, and resources start after it.
    const shared = modelOf(doc({ '/v0/{t}/a/': { get: {} }, '/v0/{t}/b/': { get: {} } }))
    expect(shared.resources.map((r) => r.name)).toEqual(['a', 'b'])
    expect(shared.prefixParameters).toEqual(['t'])
    // Past the prefix, a path under a parameter is a detail's action, even with no detail path.
    expect(names({ '/v0/{t}/a/': { get: {} }, '/v0/{t}/b/': { get: {} }, '/v1/x/': { get: {} } })).toEqual([
      ['v0', ['a', 'b']],
      ['v1X', ['get']],
    ])
    // A prefix is matched on whole segments, however it is written; a path outside it keeps its own.
    expect(names({ '/v0/a/': { get: {} }, '/w/b/': { get: {} } }, 'v0')).toEqual([
      ['a', ['get']],
      ['wB', ['get']],
    ])
    expect(names({ '/v0/a/': { get: {} } }, '//')).toEqual([['v0A', ['get']]])
  })

  it('gives clashing resources and members a name of their own, and says so', () => {
    const model = modelOf(
      doc({
        '/v0/a-b/': { get: {} },
        '/v0/a/b/': { get: {} },
        '/v0/ab/': { get: {} },
        '/v0/aB/': { get: {} },
        '/v0/x/{id}/': { get: {}, head: {} },
        '/v0/x/get/': { get: {} },
        '/v0/x/{id}/get/': { get: {} },
        '/v0/x/{id}/detail-get-get/': { get: {} },
        '/v0/x/{id}/1st/': { post: {} },
      })
    )
    expect(model.resources.map((r) => [r.name, r.members.map((m) => m.name)])).toEqual([
      ['aB', ['get']],
      ['aB2', ['get']],
      ['aB3', ['get']],
      ['ab', ['get']],
      ['x', ['get', 'headOne', '_1st', 'getGet', 'detailGetGet', 'collectionGetGet']],
    ])
    expect(model.warnings).toEqual([
      '/a/b/: "aB" is taken by another resource, so it is "aB2"',
      '/aB/: "aB" is taken by another resource, so it is "aB3"',
      'GET /v0/x/{id}/get/: "get" is taken in x, so it is "getGet"',
      'GET /v0/x/get/: "get" is taken in x, so it is "collectionGetGet"',
    ])
  })

  it('falls back to a numbered name when every other is taken', () => {
    const model = modelOf(
      doc({
        '/v0/x/{id}/': { get: {} },
        '/v0/x/get/': { get: {} },
        '/v0/x/{id}/get/': { get: {} },
        '/v0/x/{id}/collection-get-get/': { get: {} },
        '/v0/x/{id}/get-get/': { get: {} },
      })
    )
    expect(model.resources[0].members.map((m) => m.name)).toEqual([
      'get',
      'getGet',
      'getGetGet',
      'collectionGetGet',
      'get4',
    ])
  })

  it('names collection verbs as list and create beside a detail, and by verb otherwise', () => {
    expect(names({ '/v0/a/': { get: {}, post: {}, put: {} }, '/v0/a/{id}/': { put: {}, delete: {} } })).toEqual([
      ['a', ['list', 'put', 'create', 'replace', 'remove']],
    ])
  })

  it('drops a path with no operations, and reads a part-parameter segment as a word', () => {
    expect(names({ '/v0/empty/': { parameters: [] }, '/v0/x/': { get: {} } })).toEqual([['x', ['get']]])
    expect(names({ '/v0/{a}-x/{id}/': { get: {} }, '/v0/y-{b}/{id}/': { get: {} } })).toEqual([
      ['yB', ['get']],
      ['aX', ['get']],
    ])
  })

  it('takes a prefix however its slashes are written, and fills each of its parameters from the client', () => {
    expect(names({ '/v0/a/': { get: {} }, '/w/b/': { get: {} } }, '//v0//')).toEqual([
      ['a', ['get']],
      ['wB', ['get']],
    ])
    const code = generateClient(doc({ '/v0/{a}/{b}/x/': { get: {} }, '/v0/{a}/{b}/y/': { get: {} } })).code
    expect(code).toContain('  pathParams: { a: string | number; b: string | number }')
  })

  it('quotes a parameter or member name that is not an identifier', () => {
    const code = generateClient(
      doc({
        '/v0/a/{a-id}/': { get: { parameters: [{ name: 'a-id', in: 'path', required: true }], responses: ok } },
        '/v0/b/{b_id}/': { get: {} },
      })
    ).code
    expect(code).toContain('p0: PathOf<"/v0/a/{a-id}/", "get">["a-id"]')
    expect(code).toContain('path: { "a-id": p0 }')
    expect(code).toContain('path: { b_id }')
  })
})

describe('the helpers', () => {
  it('step up a path in its own slash style', () => {
    expect([
      parentOf('/a/b/'),
      parentOf('/a/b'),
      parentOf('/a/'),
      parentOf('/a'),
      parentOf('/'),
      parentOf('a'),
    ]).toEqual(['/a/', '/a', '/', '/', null, null])
  })

  it('camel-case words', () => {
    expect([camel(['rotate-secret']), camel(['read_all', 'now']), camel(['1st']), camel(['A', 'b'])]).toEqual([
      'rotateSecret',
      'readAllNow',
      '_1st',
      'aB',
    ])
  })
})
