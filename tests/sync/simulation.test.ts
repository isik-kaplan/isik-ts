import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { createMemoryAdapter } from '../../src/sync/memory'
import { U1, client, id as idOf, task } from './support/harness'
import { FakeServer } from './support/server'

// A deterministic simulation: several devices of one user and a second actor on the server, random
// writes, syncs, dropped requests, dropped responses and crashes, in any interleaving fast-check finds.
// Once the network heals and every conflict is resolved, every device must hold exactly the server's
// rows, with nothing queued - and no write may have vanished: each one the devices made either reached
// the server, or sits in a dead letter.

type Fault = 'none' | 'drop-request' | 'drop-response' | 'hang'

type Op =
  | { kind: 'create'; device: number; row: number }
  | { kind: 'update'; device: number; row: number; done: boolean; title: string }
  | { kind: 'remove'; device: number; row: number }
  | { kind: 'sync'; device: number; fault: Fault; at: number }
  | { kind: 'crash'; device: number }
  | { kind: 'server-update'; row: number; title: string }
  | { kind: 'server-delete'; row: number }

const DEVICES = 3
const ROWS = 6

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), device: fc.nat(DEVICES - 1), row: fc.nat(ROWS - 1) }),
  fc.record({
    kind: fc.constant('update' as const),
    device: fc.nat(DEVICES - 1),
    row: fc.nat(ROWS - 1),
    done: fc.boolean(),
    title: fc.constantFrom('a', 'b', 'c'),
  }),
  fc.record({ kind: fc.constant('remove' as const), device: fc.nat(DEVICES - 1), row: fc.nat(ROWS - 1) }),
  // A sync's fault strikes its `at`-th request - capabilities, push, the feed, the second push - so
  // every kind of request gets cut.
  ...Array.from({ length: 3 }, () =>
    fc.record({
      kind: fc.constant('sync' as const),
      device: fc.nat(DEVICES - 1),
      fault: fc.constantFrom<Fault>('none', 'drop-request', 'drop-response', 'drop-response', 'hang'),
      at: fc.nat(3),
    })
  ),
  fc.record({ kind: fc.constant('crash' as const), device: fc.nat(DEVICES - 1) }),
  fc.record({ kind: fc.constant('server-update' as const), row: fc.nat(ROWS - 1), title: fc.constantFrom('x', 'y') }),
  fc.record({ kind: fc.constant('server-delete' as const), row: fc.nat(ROWS - 1) })
)

async function run(ops: Op[]) {
  const server = new FakeServer()
  const faults: { fault: Fault; at: number }[] = Array.from({ length: DEVICES }, () => ({ fault: 'none', at: 0 }))
  const adapters = Array.from({ length: DEVICES }, () => createMemoryAdapter())
  let counter = 0
  const base = server.fetchAs(() => U1)

  const open = (device: number) =>
    client(server, U1, {
      adapter: adapters[device],
      generateKey: () => `k${device}-${(counter += 1)}`,
      fetch: async (input, init) => {
        const planned = faults[device]
        const fault = planned.at === 0 ? planned.fault : 'none'
        planned.at -= 1
        if (fault === 'drop-request') throw new TypeError('fetch failed')
        if (fault === 'hang') return new Promise<Response>(() => undefined)
        const response = await base(input, init)
        if (fault === 'drop-response') throw new TypeError('fetch failed')
        return response
      },
    })

  const devices = await Promise.all(Array.from({ length: DEVICES }, (_, d) => open(d)))
  const ignore = () => undefined
  const intents: { at: number; device: number; kind: Op['kind']; row: number; fields?: Record<string, unknown> }[] = []
  const made = (at: number, device: number, kind: Op['kind'], row: number, fields?: Record<string, unknown>) => () => {
    intents.push({ at, device, kind, row, fields })
  }

  for (const [at, step] of ops.entries()) {
    if (step.kind === 'create') {
      await devices[step.device]
        .create('tasks', task(idOf(step.row)))
        .then(made(at, step.device, 'create', step.row), ignore)
    }
    if (step.kind === 'update') {
      const fields = { done: step.done, title: step.title }
      await devices[step.device]
        .update('tasks', idOf(step.row), fields)
        .then(made(at, step.device, 'update', step.row, fields), ignore)
    }
    if (step.kind === 'remove') {
      await devices[step.device].remove('tasks', idOf(step.row)).then(made(at, step.device, 'remove', step.row), ignore)
    }
    if (step.kind === 'sync') {
      faults[step.device] = { fault: step.fault, at: step.at }
      if (step.fault === 'hang') {
        // The device dies with a request in flight: whatever it was sending is left marked as sent.
        devices[step.device].sync().catch(ignore)
        await new Promise((resolve) => setTimeout(resolve, 0))
        devices[step.device].close()
        faults[step.device] = { fault: 'none', at: 0 }
        devices[step.device] = await open(step.device)
      } else {
        await devices[step.device].sync().catch(ignore)
        faults[step.device] = { fault: 'none', at: 0 }
      }
    }
    if (step.kind === 'crash') {
      devices[step.device].close()
      devices[step.device] = await open(step.device)
    }
    if (step.kind !== 'server-update' && step.kind !== 'server-delete') continue
    const stored = server.rows.get('tasks')?.get(idOf(step.row))
    if (step.kind === 'server-update' && stored !== undefined)
      server.update('tasks', idOf(step.row), { title: step.title })
    if (step.kind === 'server-delete' && stored !== undefined) server.delete('tasks', idOf(step.row))
  }

  // Heal: sync everyone until nothing moves, keeping every conflict's local side.
  for (let round = 0; round < 8; round += 1) {
    for (const device of devices) {
      await device.sync()
      for (const conflict of await device.pendingEntries({ state: 'conflict' })) await device.keepMine(conflict.seq)
      await device.sync()
    }
  }
  return { server, devices, intents }
}

describe('the simulation', () => {
  it('converges, and loses no write, whatever the interleaving', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 40 }), async (ops) => {
        const { server, devices, intents } = await run(ops)
        const expected = [...(server.rows.get('tasks')?.values() ?? [])]
          .map((stored) => stored.data)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        for (const device of devices) {
          expect(await device.pendingCounts()).toMatchObject({ pending: 0, sending: 0, conflicts: 0 })
          expect(await device.query('tasks')).toEqual(expected)
          expect(device.status().paused).toBeNull()
          // Nothing reached a dead letter but what the server refused: an update to a row deleted
          // under it, or a create of a row that already exists.
          for (const letter of await device.deadLetters()) {
            expect(['deleted', 'rejected']).toContain(letter.reason)
            if (letter.reason !== 'rejected') continue
            const row = letter.entry.id
            const creators = new Set(
              intents.filter((i) => i.kind === 'create' && idOf(i.row) === row).map((i) => i.device)
            )
            const deletedElsewhere =
              ops.some((o) => o.kind === 'server-delete' && idOf(o.row) === row) ||
              intents.some((i) => i.kind === 'remove' && idOf(i.row) === row)
            // A 409 needs a second create of that id; a 404, a delete it raced.
            if (letter.status === 409)
              expect(
                creators.size > 1 ||
                  deletedElsewhere ||
                  intents.filter((i) => i.kind === 'create' && idOf(i.row) === row).length > 1
              ).toBe(true)
            else expect(letter.status === 404 && deletedElsewhere).toBe(true)
          }
        }
        // No write vanished. Each create and update a device made reached the server under that
        // device's key, or sits in its dead letters, or was superseded on that device by a later write
        // to the same row - which folds into, or cancels, what was still queued.
        for (const intent of intents) {
          if (intent.kind === 'remove') continue
          const row = idOf(intent.row)
          const superseded = intents.some(
            (later) => later.device === intent.device && later.row === intent.row && later.at > intent.at
          )
          if (superseded) continue
          const reached = server.applied.some(
            (entry) =>
              entry.key.startsWith(`k${intent.device}-`) &&
              entry.id === row &&
              (intent.kind === 'create'
                ? entry.method === 'POST'
                : entry.body !== undefined &&
                  Object.entries(intent.fields ?? {}).every(([f, v]) => entry.body?.[f] === v))
          )
          const buried = (await devices[intent.device].deadLetters()).some((letter) => letter.entry.id === row)
          expect(reached || buried, `${intent.kind} of ${row} by device ${intent.device} at ${intent.at}`).toBe(true)
        }
        // And no create ran twice: idempotency held across every retry.
        const posts = server.applied.filter((entry) => entry.method === 'POST').map((entry) => entry.key)
        expect(new Set(posts).size).toBe(posts.length)
      }),
      { numRuns: 150, seed: 20261112 }
    )
  }, 120_000)
})
