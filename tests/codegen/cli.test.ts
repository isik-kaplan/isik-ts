// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Io, main } from '../../src/codegen/cli'

const document = { openapi: '3.0.3', paths: { '/v0/a/{id}/': { get: {} }, '/v0/a/get/': { get: {} } } }

function io(files: Record<string, string> = {}) {
  const written: Record<string, string> = {}
  const out: string[] = []
  const err: string[] = []
  const fake: Io = {
    read: (file) => {
      if (!(file in files)) throw new Error(`ENOENT: ${file}`)
      return files[file]
    },
    write: (file, content) => {
      written[file] = content
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  }
  return { fake, written, out, err }
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('isikk-gen-client', () => {
  it('writes the client from YAML or JSON, with its options, and reports clashes', () => {
    const run = io({
      'api.yml': 'openapi: 3.0.3\npaths:\n  /v0/a/: { get: {} }\n',
      'api.json': JSON.stringify(document),
    })
    expect(main(['api.yml', '-o', 'client.ts'], run.fake)).toBe(0)
    expect(run.written['client.ts']).toContain('import type { paths } from "./schema"')
    expect(run.written['client.ts']).toContain('- api.yml. Do not edit.')
    expect(run.written['client.ts']).toContain('// Idempotency keys: every-write.')
    expect(
      main(['--types', '../schema', 'api.json', '--out', 'b.ts', '--keys', 'declared', '--strip-prefix', '/'], run.fake)
    ).toBe(0)
    expect(run.written['b.ts']).toContain('from "../schema"')
    expect(run.written['b.ts']).toContain('// Idempotency keys: declared.')
    expect(run.written['b.ts']).toContain('    v0A: {')
    expect(run.err).toEqual(['isikk-gen-client: GET /v0/a/get/: "get" is taken in v0A, so it is "collectionGet"\n'])
    expect(main(['api.json', '-o', 'c.ts', '--include', '/v0/a/get/', '--strip-prefix', '/v0/'], run.fake)).toBe(0)
    expect(run.written['c.ts']).toContain('    aGet: {')
    expect(run.written['c.ts']).not.toContain('{id}')
    expect(
      main(['api.json', '-o', 'r.ts', '--rename', 'root.collectionGet=all', '--rename', 'root=items'], run.fake)
    ).toBe(0)
    expect(run.written['r.ts']).toContain('    items: {')
    expect(run.written['r.ts']).toContain('      all: (')
    const lists = io({
      'l.json': JSON.stringify({
        paths: {
          '/v0/a/{id}/': { get: {} },
          '/v0/a/b/': {
            get: { responses: { '200': { content: { 'application/json': { schema: { type: 'array' } } } } } },
          },
          '/v0/c/': { get: {} },
        },
      }),
    })
    expect(main(['l.json', '-o', 'p.ts'], lists.fake)).toBe(0)
    expect(main(['l.json', '-o', 's.ts', '--no-plurals'], lists.fake)).toBe(0)
    expect([lists.written['p.ts'].includes('      bs: ('), lists.written['s.ts'].includes('      b: (')]).toEqual([
      true,
      true,
    ])
    expect(run.out).toEqual([])
  })

  it('prints its usage for help, and for arguments it cannot use', () => {
    const run = io()
    expect(main(['--help'], run.fake)).toBe(0)
    expect(main(['-h'], run.fake)).toBe(0)
    expect(run.out[0]).toMatch(/^Usage: isikk-gen-client/)
    expect(main([], run.fake)).toBe(2)
    expect(main(['a.yml'], run.fake)).toBe(2)
    expect(main(['a.yml', 'b.yml', '-o', 'c.ts'], run.fake)).toBe(2)
    expect(main(['a.yml', '--nope', 'x'], run.fake)).toBe(2)
    expect(main(['a.yml', '-o'], run.fake)).toBe(2)
    for (const bad of ['x', 'a=b=c', '=b', 'a='])
      expect(main(['a.yml', '-o', 'c.ts', '--rename', bad], run.fake)).toBe(2)
    expect(run.err[0]).toMatch(/^Usage:/)
    expect(run.err[3]).toMatch(/^isikk-gen-client: unknown option --nope\n\nUsage:/)
    expect(run.err[4]).toMatch(/^isikk-gen-client: -o needs a value\n\nUsage:/)
    expect(run.err.slice(5)).toEqual(
      ['x', 'a=b=c', '=b', 'a='].map((bad) =>
        expect.stringMatching(new RegExp(`^isikk-gen-client: --rename takes <from>=<to>, not ${bad}\\n`))
      )
    )
    expect(run.written).toEqual({})
  })

  it('reports a file it cannot read or parse, or a document it cannot use', () => {
    const run = io({ 'bad.json': '{', 'list.yml': '- 1', 'api.json.yml': 'openapi: 3.0.3\npaths: {}\n' })
    expect(main(['api.json.yml', '-o', 'ok.ts'], run.fake)).toBe(0)
    expect(main(['missing.yml', '-o', 'c.ts'], run.fake)).toBe(1)
    expect(main(['bad.json', '-o', 'c.ts'], run.fake)).toBe(1)
    expect(main(['list.yml', '-o', 'c.ts'], run.fake)).toBe(1)
    expect(main(['list.yml', '-o', 'c.ts', '--keys', 'x'], run.fake)).toBe(1)
    expect(Object.keys(run.written)).toEqual(['ok.ts'])
    delete run.written['ok.ts']
    expect(run.err[0]).toBe('isikk-gen-client: ENOENT: missing.yml\n')
    expect(run.err[1]).toMatch(/^isikk-gen-client: .*JSON/)
    expect(run.err[2]).toBe('isikk-gen-client: codegen: the document has no `paths` - is it an OpenAPI document?\n')
    expect(run.written).toEqual({})
  })

  it('reports a thrown value that is not an Error', () => {
    const run = io()
    run.fake.read = () => {
      // eslint-disable-next-line no-throw-literal
      throw 'plain'
    }
    expect(main(['a.yml', '-o', 'c.ts'], run.fake)).toBe(1)
    expect(run.err).toEqual(['isikk-gen-client: plain\n'])
  })

  it('reads and writes real files, and reports through the process, by default', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'isikk-gen-'))
    writeFileSync(path.join(dir, 'api.json'), JSON.stringify(document))
    writeFileSync(path.join(dir, 'api.yml'), 'openapi: 3.0.3\npaths:\n  /v0/z/: { get: {} }\n')
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(main([path.join(dir, 'api.json'), '-o', path.join(dir, 'client.ts')])).toBe(0)
    expect(readFileSync(path.join(dir, 'client.ts'), 'utf8')).toContain('export function createClient')
    expect(main([path.join(dir, 'api.yml'), '-o', path.join(dir, 'yml.ts')])).toBe(0)
    expect(readFileSync(path.join(dir, 'yml.ts'), 'utf8')).toContain('    z: {')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('is taken in root'))
    expect(main(['--help'])).toBe(0)
    expect(stdout).toHaveBeenCalledWith(expect.stringMatching(/^Usage/))
    // The first two are node's and the script's own, which the command never reads as arguments.
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['--help', '--help'])
    await import('../../src/codegen/bin')
    expect(process.exitCode).toBe(2)
  })
})
