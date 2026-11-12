import { describe, expect, it } from 'vitest'

import { client, id, task } from './support/harness'
import { FakeServer } from './support/server'

describe('smoke', () => {
  it('converges two devices', async () => {
    const server = new FakeServer()
    const a = await client(server)
    const b = await client(server)
    await a.create('tasks', task(id(1)))
    await a.sync()
    await b.sync()
    expect(await b.get('tasks', id(1))).toEqual(task(id(1)))
    await b.update('tasks', id(1), { done: true })
    await a.update('tasks', id(1), { title: 'renamed' })
    await b.sync()
    await a.sync()
    await b.sync()
    expect(await a.get('tasks', id(1))).toEqual(task(id(1), { done: true, title: 'renamed' }))
    expect(await b.get('tasks', id(1))).toEqual(task(id(1), { done: true, title: 'renamed' }))
    expect(a.status()).toMatchObject({ pending: 0, conflicts: 0, dead: 0, paused: null })
  })
})
