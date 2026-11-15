// @vitest-environment node
import { readFileSync } from 'fs'
import openapiTS, { astToString } from 'openapi-typescript'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { generateClient } from '../../src/codegen'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, 'fixture.yml'), 'utf8')
const document = parse(source) as unknown

// The generated files are committed, and checked by tsc with the rest of the project; `vitest -u`
// writes them afresh. A change to the generator shows up as a diff in them.
describe('the generated files', () => {
  it("are openapi-typescript's types for the fixture", async () => {
    const types = astToString(await openapiTS(source))
    await expect(types).toMatchFileSnapshot('generated/schema.ts')
  })

  it("fill a parameter in the shared prefix from the client, as allauth's {client}", async () => {
    const prefixed = readFileSync(path.join(here, 'prefixed.yml'), 'utf8')
    await expect(astToString(await openapiTS(prefixed))).toMatchFileSnapshot('generated/schema.prefixed.ts')
    const generated = generateClient(parse(prefixed), { types: './schema.prefixed', keys: 'minted' })
    await expect(generated.code).toMatchFileSnapshot('generated/client.prefixed.ts')
    expect(generated.warnings).toEqual([])
  })

  it('are the client, under each key rule, and say which names clashed', async () => {
    const warnings = new Set<string>()
    for (const keys of ['every-write', 'declared', 'minted'] as const) {
      const generated = generateClient(document, { keys, source: 'fixture.yml' })
      await expect(generated.code).toMatchFileSnapshot(`generated/client.${keys}.ts`)
      for (const warning of generated.warnings) warnings.add(warning)
    }
    expect([...warnings]).toEqual([
      'GET /v0/tasks/list/: "list" is taken in tasks, so it is "getList"',
      'GET /v0/tasks/stats/: "stats" is taken in tasks, so it is "getStats"',
    ])
  })
})
