# sync (`@isikk/core/sync`, `@isikk/core/sync/react`)

Offline sync for an API that speaks the isik sync protocol: a local copy of the user's rows on the
device, writes that work offline and reach the server later, and a feed that keeps the copy current.
Web (IndexedDB) and mobile (expo-sqlite) share one engine.

The protocol is `protocol/sync/v1/` in this repository: `PROTOCOL.md`, a JSON Schema for every
message, and the fixtures both sides run. This page is the client.

## Setup

```typescript
import { createDjangoFetch } from '@isikk/core'
import { createIndexedDBAdapter, openSyncEngine } from '@isikk/core/sync'

import openapi from './openapi.json'
import type { components } from './schema'

type Tables = { tasks: components['schemas']['Task']; projects: components['schemas']['Project'] }

const engine = await openSyncEngine<Tables>({
  adapter: createIndexedDBAdapter(),
  user: session.user.id,
  document: openapi, // its `x-sync` extensions name the synced resources
  baseUrl: 'https://api.example.com',
  fetch: createDjangoFetch({ baseUrl: 'https://api.example.com' }),
})
engine.start()
```

On React Native, the adapter is SQLite through expo-sqlite, and `foreground` brings `AppState` in:

```typescript
import { createSQLiteAdapter, expoSQLite, openSyncEngine } from '@isikk/core/sync'

import * as SQLite from 'expo-sqlite'
import { AppState } from 'react-native'

const engine = await openSyncEngine<Tables>({
  adapter: createSQLiteAdapter(expoSQLite(SQLite)),
  foreground: (onForeground) => {
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && onForeground())
    return () => subscription.remove()
  },
  // ...as above
})
```

`createMemoryAdapter()` keeps everything in memory: for tests, and for server rendering.

| option      | default                        |                                                                                                            |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `push`      | `batchPush`                    | `restPush` replays each write through its REST endpoint instead; a project can pass its own `PushStrategy` |
| `batchSize` | none                           | the most writes one push carries; the server's advertised limit caps it too                                |
| `pageSize`  | the server's                   | the feed's `limit`                                                                                         |
| `debounce`  | 500 ms                         | how long after a local write a sync starts                                                                 |
| `interval`  | 30 s                           | how often to sync while visible; `0` never                                                                 |
| `backoff`   | 1 s, doubling to 5 min         | after a failure; a `Retry-After` wins                                                                      |
| `locks`     | `navigator.locks`              | `null` keeps the lock to the page                                                                          |
| `broadcast` | when `BroadcastChannel` exists | tell other tabs of changes                                                                                 |

There is no default batch size: the server says what it takes (`GET /sync/capabilities`, or a `413`),
and the project may say less.

## Reading and writing

```typescript
await engine.get('tasks', id)
await engine.query('tasks', { index: ['project', 'due'], equals: [projectId] })
await engine.query('tasks', { index: ['project', 'due'], lower: [projectId, '2026-01-01'], upper: [projectId] })
await engine.count('tasks')

const task = await engine.create('tasks', { title: 'New', owner: me }) // a uuid7 id unless one is given
await engine.update('tasks', task.id, { done: true })
await engine.remove('tasks', task.id)
```

- A query is by id, or over one of the `indexed` field lists `x-sync` declares, by a prefix (`equals`)
  or bounds (`lower`, `upper`, either open). Values order null, false, true, numbers, strings.
- A write lands in the local row at once and queues for the server. Writes to one row fold while they
  wait: updates merge into one, keeping each field's original value as the base for the 412 check; an
  update to a queued create goes into the create; a delete of a queued create cancels both.
- A write naming a row this device created and has not yet sent - a task's `project` - waits for that
  create, and goes in the same push, after it.

## What the server answers

| answer                     | the write                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `2xx`                      | done; the row takes the server's copy                                                                    |
| `412`, my fields untouched | sent again at once against the new version                                                               |
| `412`, my fields changed   | frozen as a conflict, with the server's row beside it: `takeTheirs(seq)`, `keepMine(seq)`                |
| `400`, `403`, `404`, `409` | a dead letter, with the errors: `retryDead(seq)`, `discardDead(seq)`, `exportDead()`; the row rolls back |
| `401`                      | the queue pauses until `resume()` - after a fresh login                                                  |
| `428`                      | the queue stops: the client sent a write without its etag, a bug                                         |
| `5xx`, `429`, no answer    | kept, and sent again after a backoff - under the same key when no answer came, so it cannot run twice    |

A delete answered `404` is done. A row the feed deletes takes its queued updates to the dead letters
(they can never land); a revoked scope takes its rows' writes there too. Nothing is dropped silently.

## The feed

- A first sync, a `410`, a granted scope, and a table whose `x-sync` hash changed are each a snapshot.
  A snapshot is staged and swapped in when it ends, so the rows shown never half-update.
- A table whose hash changed is emptied - keeping rows with writes queued - and snapshotted alone.
- A revoked scope's rows are deleted at once.
- The server's changes apply under the row's own queued writes: a field I changed shows mine until it
  lands, the rest show theirs.

## When it syncs

`start()` syncs at once, then on `online`, on the page becoming visible (or `foreground`), a debounce
after each local write, and on the interval while visible. One sync - push, pull, push - runs at a
time across tabs, under one Web Lock; tabs hear each other's writes over `BroadcastChannel`. `sync()`
syncs now. `stop()` and `close()` end it.

## Status, the queue, logging out

```typescript
engine.status() // { online, syncing, paused, lastSyncedAt, pending, conflicts, dead, loading, error }
await engine.pendingCounts()
await engine.pendingEntries({ state: 'conflict', offset: 0, limit: 50 })
await engine.deadLetters({ offset: 0, limit: 50 })

await engine.wipe() // on an explicit logout: throws PendingWritesError while anything is unsent
await engine.wipe({ force: true }) // after warning the user
```

An expired session never wipes anything: the queue pauses on `401` and waits for `resume()`.

## React (`@isikk/core/sync/react`)

Each hook takes the engine first; where it lives is the app's choice.

```tsx
const { data: tasks } = useLiveQuery(engine, (e) => e.query('tasks', { index: ['project'], equals: [id] }), [id])
const { create, update, remove } = useSyncedWrite(engine)
const { counts, conflicts, dead, takeTheirs, keepMine, retryDead, discardDead, exportDead } = usePendingWrites(engine, {
  limit: 20,
})
const { online, syncing, paused } = useSyncStatus(engine)
```

`useLiveQuery` reruns on any change to the local store - this tab's, another's, a pull's - or only on
the `models` it names. `usePendingWrites` pages; it never loads every queued write.

## Writing an adapter or a push strategy

An adapter implements `StoreAdapter`: string-keyed records with string index values, ranges over
them, and transactions that end once a macrotask passes with no operation outstanding (IndexedDB's
rule - `createTxGuard` gives it to a backend without one). A push strategy is
`(entries, context) => Promise<{ results, refused? }>`.
