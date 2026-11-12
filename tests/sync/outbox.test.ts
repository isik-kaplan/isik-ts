import { describe, expect, it } from 'vitest'

import type { Entry } from '../../src/sync/outbox'
import {
  deepEqual,
  materialize,
  outcomeOf,
  rebasable,
  referencesOf,
  rowKeyOf,
  selectBatch,
} from '../../src/sync/outbox'

let seq = 0
function entry(fields: Partial<Entry> = {}): Entry {
  seq += 1
  return {
    seq,
    model: 'tasks',
    id: `r${seq}`,
    method: 'PATCH',
    body: {},
    base: {},
    key: `k${seq}`,
    protocol: 1,
    state: 'pending',
    attempts: 0,
    createdAt: 0,
    ...fields,
  }
}

const NO_LIMITS = { maxEntries: Infinity, maxBytes: Infinity }
const wire = (e: Entry) => ({ key: e.key })
const keys = (selection: { batch: { entry: Entry }[] }) => selection.batch.map((b) => b.entry.key)

describe('materialize', () => {
  const server = { etag: '"1"', data: { id: 'a', title: 'x', done: false } }

  it('is the server copy with nothing queued, and null with neither', () => {
    expect(materialize(server, [])).toEqual(server.data)
    expect(materialize(null, [])).toBeNull()
  })

  it('applies creates, updates and deletes in order', () => {
    expect(materialize(null, [entry({ method: 'POST', body: { id: 'a', title: 'new' } })])).toEqual({
      id: 'a',
      title: 'new',
    })
    expect(materialize(server, [entry({ body: { title: 'y' } }), entry({ body: { done: true } })])).toEqual({
      id: 'a',
      title: 'y',
      done: true,
    })
    expect(materialize(server, [entry({ method: 'DELETE', body: undefined })])).toBeNull()
    expect(materialize(server, [entry({ method: 'DELETE' }), entry({ method: 'POST', body: { id: 'a' } })])).toEqual({
      id: 'a',
    })
  })

  it('applies an update to nothing as nothing', () => {
    expect(materialize(null, [entry({ body: { title: 'y' } })])).toBeNull()
  })

  it('leaves the server copy untouched', () => {
    materialize(server, [entry({ body: { title: 'y' } })])
    expect(server.data.title).toBe('x')
  })
})

describe('deepEqual', () => {
  it('compares JSON values', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('a', 'b')).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({}, null)).toBe(false)
    expect(deepEqual(1, {})).toBe(false)
    expect(deepEqual({}, 1)).toBe(false)
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    // As JSON, where an undefined field is no field.
    expect(deepEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(true)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    expect(deepEqual([], [])).toBe(true)
  })
})

describe('rebasable', () => {
  it('is an update whose every changed field the server still has at its base', () => {
    const update = entry({ body: { title: 'mine', tags: ['a'] }, base: { title: 'old', tags: [] } })
    expect(rebasable(update, { title: 'old', tags: [], done: true })).toBe(true)
    expect(rebasable(update, { title: 'theirs', tags: [] })).toBe(false)
    expect(rebasable(update, { title: 'old', tags: ['b'] })).toBe(false)
  })

  it('is never a delete or a create', () => {
    expect(rebasable(entry({ method: 'DELETE', body: undefined }), {})).toBe(false)
    expect(rebasable(entry({ method: 'POST', body: {} }), {})).toBe(false)
  })

  it('is an update with no body', () => {
    expect(rebasable(entry({ body: undefined }), {})).toBe(true)
  })
})

describe('referencesOf', () => {
  it('finds strings at the top level and one level down, not deeper', () => {
    const found = referencesOf({ a: 'x', b: ['y', 1, null], c: { d: 'z', e: { f: 'deep' } } })
    expect([...found].sort()).toEqual(['x', 'y', 'z'])
  })

  it('finds nothing in no body', () => {
    expect(referencesOf(undefined).size).toBe(0)
  })
})

describe('selectBatch', () => {
  it('takes entries in order, one per row', () => {
    const a1 = entry({ id: 'a' })
    const b = entry({ id: 'b' })
    const a2 = entry({ id: 'a' })
    expect(keys(selectBatch([a1, b, a2], NO_LIMITS, new Set(), wire))).toEqual([a1.key, b.key])
    expect(selectBatch([a1], NO_LIMITS, new Set(), wire).batch[0].wire).toEqual({ key: a1.key })
  })

  it('keeps one model apart from another with the same id', () => {
    const a = entry({ id: 'x', model: 'tasks' })
    const b = entry({ id: 'x', model: 'notes' })
    expect(keys(selectBatch([a, b], NO_LIMITS, new Set(), wire))).toEqual([a.key, b.key])
    expect(rowKeyOf('tasks', 'x')).not.toBe(rowKeyOf('notes', 'x'))
  })

  it('holds a row with a conflict back, all of it', () => {
    const conflict = entry({ id: 'a', state: 'conflict' })
    const after = entry({ id: 'a' })
    const other = entry({ id: 'b' })
    expect(keys(selectBatch([conflict, after, other], NO_LIMITS, new Set(), wire))).toEqual([other.key])
  })

  it('sends a sending entry again', () => {
    const sending = entry({ state: 'sending' })
    expect(keys(selectBatch([sending], NO_LIMITS, new Set(), wire))).toEqual([sending.key])
  })

  it('sends a child after its parent create in the same batch, and holds it when the parent is not in it', () => {
    const parent = entry({ method: 'POST', id: 'p', body: { id: 'p' } })
    const child = entry({ method: 'POST', id: 'c', body: { id: 'c', project: 'p' } })
    expect(keys(selectBatch([parent, child], NO_LIMITS, new Set(), wire))).toEqual([parent.key, child.key])
    expect(keys(selectBatch([parent, child], { maxEntries: 1, maxBytes: Infinity }, new Set(), wire))).toEqual([
      parent.key,
    ])
    const conflictedParentRow = entry({ id: 'p', state: 'conflict' })
    expect(keys(selectBatch([conflictedParentRow, parent, child], NO_LIMITS, new Set(), wire))).toEqual([])
  })

  it('waits only on creates: a reference to a row with a held-back update goes', () => {
    const conflicted = entry({ id: 'p', state: 'conflict' })
    const child = entry({ method: 'POST', id: 'c', body: { id: 'c', project: 'p' } })
    expect(keys(selectBatch([conflicted, child], NO_LIMITS, new Set(), wire))).toEqual([child.key])
  })

  it('holds a child of a dead create for good, and ignores a reference to itself or an unknown id', () => {
    const child = entry({ body: { project: 'gone' } })
    expect(keys(selectBatch([child], NO_LIMITS, new Set(['gone']), wire))).toEqual([])
    const self = entry({ method: 'POST', id: 's', body: { id: 's', note: 'unrelated' } })
    expect(keys(selectBatch([self], NO_LIMITS, new Set(), wire))).toEqual([self.key])
  })

  it('stops at the entry limit', () => {
    const list = [entry(), entry(), entry()]
    expect(keys(selectBatch(list, { maxEntries: 2, maxBytes: Infinity }, new Set(), wire))).toEqual([
      list[0].key,
      list[1].key,
    ])
  })

  it('stops at the byte limit, counting the envelope and commas, and sets aside an entry too big alone', () => {
    const small = entry({ key: 'aaaa' })
    const big = entry({ key: 'b'.repeat(100) })
    const after = entry({ key: 'cccc' })
    // {"entries":[]} is 14 bytes; {"key":"aaaa"} is 14, and its comma 1.
    const two = selectBatch([small, after], { maxEntries: Infinity, maxBytes: 14 + 15 + 15 }, new Set(), wire)
    expect(keys(two)).toEqual(['aaaa', 'cccc'])
    const one = selectBatch([small, after], { maxEntries: Infinity, maxBytes: 14 + 15 + 14 }, new Set(), wire)
    expect(keys(one)).toEqual(['aaaa'])
    const exact = selectBatch([small], { maxEntries: Infinity, maxBytes: 14 + 15 }, new Set(), wire)
    expect(keys(exact)).toEqual(['aaaa'])
    const tooBig = selectBatch([small, big, after], { maxEntries: Infinity, maxBytes: 60 }, new Set(), wire)
    expect(keys(tooBig)).toEqual(['aaaa', 'cccc'])
    expect(tooBig.tooLarge).toEqual([big])
  })

  it('counts multi-byte characters as their UTF-8 bytes', () => {
    const wide = entry({ key: 'é' })
    // {"key":"é"} is 11 characters and 12 bytes, and its comma 1.
    expect(keys(selectBatch([wide], { maxEntries: Infinity, maxBytes: 14 + 12 }, new Set(), wire))).toEqual([])
    expect(keys(selectBatch([wide], { maxEntries: Infinity, maxBytes: 14 + 13 }, new Set(), wire))).toEqual(['é'])
  })
})

describe('outcomeOf', () => {
  const update = entry({ body: { title: 'mine' }, base: { title: 'old' } })
  const remove = entry({ method: 'DELETE', body: undefined })
  const result = (status: number, extra = {}) => ({ key: 'k', status, ...extra })

  it.each([
    [200, 'done'],
    [201, 'done'],
    [204, 'done'],
    [299, 'done'],
    [199, 'dead'],
    [100, 'dead'],
    [400, 'dead'],
    [403, 'dead'],
    [404, 'dead'],
    [409, 'dead'],
    [410, 'dead'],
    [422, 'dead'],
    [300, 'dead'],
    [401, 'pause'],
    [428, 'fatal'],
    [408, 'retry'],
    [425, 'retry'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ])('reads %i on an update as %s', (status, outcome) => {
    expect(outcomeOf(update, result(status))).toBe(outcome)
  })

  it('reads a delete of what is already gone as done', () => {
    expect(outcomeOf(remove, result(404))).toBe('done')
    expect(outcomeOf(remove, result(410))).toBe('done')
    expect(outcomeOf(remove, result(403))).toBe('dead')
  })

  it('reads a 412 as a rebase when nobody touched my fields, else a conflict', () => {
    expect(outcomeOf(update, result(412, { current: { title: 'old' } }))).toBe('rebase')
    expect(outcomeOf(update, result(412, { current: { title: 'theirs' } }))).toBe('conflict')
    expect(outcomeOf(remove, result(412, { current: {} }))).toBe('conflict')
  })

  it('reads a 412 without the current row as dead', () => {
    expect(outcomeOf(update, result(412))).toBe('dead')
  })
})
