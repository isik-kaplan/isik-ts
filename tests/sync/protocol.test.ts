import { describe, expect, it } from 'vitest'

import { resourcesOf, scopeOf } from '../../src/sync/protocol'
import { MODELS, openAPIDocument } from './support/server'

describe('resourcesOf', () => {
  it("reads every component's x-sync, by model", () => {
    const resources = resourcesOf({
      components: { schemas: { ...openAPIDocument().components.schemas, Plain: { type: 'object' } } },
    })
    expect([...resources.keys()].sort()).toEqual(['notes', 'projects', 'tasks'])
    expect(resources.get('tasks')).toEqual(MODELS.tasks)
  })

  it('reads nothing from a document without components or schemas', () => {
    expect(resourcesOf({}).size).toBe(0)
    expect(resourcesOf({ components: {} }).size).toBe(0)
    expect(resourcesOf(undefined).size).toBe(0)
  })

  it('refuses a resource on another protocol version', () => {
    const document = openAPIDocument({ tasks: { ...MODELS.tasks, protocol: 2 } })
    expect(() => resourcesOf(document)).toThrow('sync: tasks speaks sync protocol 2, and this client speaks 1')
  })
})

describe('scopeOf', () => {
  it("is the scope's kind and the row's scope field", () => {
    expect(scopeOf(MODELS.notes, { team: 'abc' })).toBe('team:abc')
  })
})
