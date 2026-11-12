import { afterEach, describe, expect, it, vi } from 'vitest'

import { PendingWritesError } from '../../src/sync/engine'
import { createMemoryAdapter } from '../../src/sync/memory'
import { U1, client, id, task } from './support/harness'
import { FakeServer } from './support/server'

// When the engine syncs, and how it lives and dies.

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function counting(server: FakeServer, fail: () => Response | null = () => null) {
  const base = server.fetchAs(() => U1)
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new URL(String(input)).pathname)
    return fail() ?? base(input, init)
  }
  const feeds = () => calls.filter((path) => path === '/sync/changes').length
  return { fetch, calls, feeds }
}

describe('starting', () => {
  it('syncs at once, then on coming online, becoming visible, the foreground, and the interval while visible', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, feeds } = counting(server)
    let foreground: () => void = () => undefined
    const unsubscribeForeground = vi.fn()
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } })
    const engine = await client(server, U1, {
      fetch,
      interval: 10_000,
      foreground: (callback) => {
        foreground = callback
        return unsubscribeForeground
      },
    })
    engine.start()
    engine.start()
    expect(persist).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(1)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(2)

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(3)

    foreground()
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(4)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(feeds()).toBe(5)

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(feeds()).toBe(5)
    hidden.mockRestore()

    engine.stop()
    expect(unsubscribeForeground).toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(feeds()).toBe(5)
  })

  it('polls without a document, and never with interval 0', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, feeds } = counting(server)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('window', undefined)
    const engine = await client(server, U1, { fetch, interval: 1000 })
    engine.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(feeds()).toBe(3)
    engine.close()
    vi.unstubAllGlobals()

    const quiet = await client(server, U1, { fetch, interval: 0 })
    quiet.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(feeds()).toBe(4)
    quiet.close()
  })

  it('syncs a debounce after a local write', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, calls } = counting(server)
    const engine = await client(server, U1, { fetch, debounce: 500 })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    const before = calls.length
    await engine.create('tasks', task(id(1)))
    await vi.advanceTimersByTimeAsync(499)
    expect(calls.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toContain('/sync/push')
    expect(server.rows.get('tasks')?.size).toBe(1)
  })

  it('uses its defaults: a 500ms debounce and a 30s interval', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, feeds } = counting(server)
    const engine = await client(server, U1, { fetch, debounce: undefined, interval: undefined })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    await engine.create('tasks', task(id(1)))
    await vi.advanceTimersByTimeAsync(500)
    expect(server.rows.get('tasks')?.size).toBe(1)
    const after = feeds()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(feeds()).toBe(after + 1)
    engine.close()
  })

  it('does nothing once closed', async () => {
    const server = new FakeServer()
    const { fetch, calls } = counting(server)
    const engine = await client(server, U1, { fetch })
    engine.close()
    engine.start()
    await engine.sync()
    expect(calls).toEqual([])
  })
})

describe('backing off', () => {
  it('waits base, then twice that, up to max, and starts over after a success', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    let down = true
    const { fetch, feeds } = counting(server, () => (down ? new Response(null, { status: 503 }) : null))
    const engine = await client(server, U1, { fetch, backoff: { base: 100, max: 300 } })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(feeds()).toBe(2)
    await vi.advanceTimersByTimeAsync(199)
    expect(feeds()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(feeds()).toBe(3)
    await vi.advanceTimersByTimeAsync(300)
    expect(feeds()).toBe(4)
    await vi.advanceTimersByTimeAsync(300)
    expect(feeds()).toBe(5)
    down = false
    await vi.advanceTimersByTimeAsync(300)
    expect(feeds()).toBe(6)
    down = true
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(feeds()).toBe(8)
    engine.close()
  })

  it('defaults to 1s, doubling to 5 minutes, and honours Retry-After', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    let retryAfter: string | null = null
    const { fetch, feeds } = counting(
      server,
      () => new Response(null, { status: 503, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } })
    )
    const engine = await client(server, U1, { fetch })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(999)
    expect(feeds()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(feeds()).toBe(2)
    for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(300_000)
    const capped = feeds()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(feeds()).toBe(capped + 1)
    engine.close()

    retryAfter = '42'
    const told = counting(
      server,
      () => new Response(null, { status: 503, headers: { 'Retry-After': retryAfter as string } })
    )
    const patient = await client(server, U1, { fetch: told.fetch })
    patient.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(41_999)
    expect(told.feeds()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(told.feeds()).toBe(2)
    patient.close()
  })
})

describe('syncing', () => {
  it('runs one more sync, shared, for every sync asked for while one runs', async () => {
    const server = new FakeServer()
    let release: () => void = () => undefined
    let hold = true
    const base = server.fetchAs(() => U1)
    const { calls } = counting(server)
    const engine = await client(server, U1, {
      fetch: async (input, init) => {
        calls.push(new URL(String(input)).pathname)
        if (hold) {
          hold = false
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        return base(input, init)
      },
    })
    const first = engine.sync()
    const second = engine.sync()
    const third = engine.sync()
    expect(second).toBe(third)
    await vi.waitFor(() => expect(hold).toBe(false))
    release()
    await Promise.all([first, second, third])
    expect(calls.filter((path) => path === '/sync/changes')).toHaveLength(2)
  })

  it('runs a queued sync even after the running one failed', async () => {
    const server = new FakeServer()
    let fail = true
    const { fetch, feeds } = counting(server, () => {
      if (!fail) return null
      fail = false
      return new Response(null, { status: 418 })
    })
    const engine = await client(server, U1, { fetch })
    const first = engine.sync()
    const second = engine.sync()
    await expect(first).rejects.toThrow()
    await second
    // The first failed at its capabilities; the second ran whole.
    expect(feeds()).toBe(1)
  })

  it('holds a Web Lock for the whole of a sync', async () => {
    const server = new FakeServer()
    const names: string[] = []
    const locks = {
      request: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
        names.push(name)
        return callback()
      }),
      query: vi.fn(),
    } as unknown as LockManager
    const engine = await client(server, U1, { locks })
    await engine.sync()
    expect(names).toEqual([`isik-sync:${U1}`])
  })

  it('uses navigator.locks when there is one, and a lock of its own when not', async () => {
    const request = vi.fn(async (_: string, callback: () => Promise<unknown>) => callback())
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    const engine = await client(new FakeServer(), U1, { locks: undefined })
    await engine.sync()
    expect(request).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
    vi.stubGlobal('navigator', undefined)
    const own = await client(new FakeServer(), U1, { locks: undefined })
    await own.sync()
    expect(own.status().lastSyncedAt).not.toBeNull()
  })

  it('swallows the failure of a sync the interval started, and of asking for persistent storage', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch, calls } = counting(server, () => new Response(null, { status: 418 }))
    vi.stubGlobal('navigator', { ...navigator, storage: { persist: () => Promise.reject(new Error('denied')) } })
    const engine = await client(server, U1, { fetch, interval: 1000 })
    engine.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    engine.close()
  })

  it('swallows the failure of a sync it scheduled itself', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const { fetch } = counting(server, () => new Response(null, { status: 418 }))
    const engine = await client(server, U1, { fetch })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.status().error).toBeInstanceOf(Error)
    engine.close()
  })

  it('resumes after a pause, and syncs', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    let refuse = true
    const { fetch, calls, feeds } = counting(server, () => (refuse ? new Response(null, { status: 401 }) : null))
    const engine = await client(server, U1, { fetch })
    engine.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.status().paused).toBe('unauthorized')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
    expect(feeds()).toBe(0)
    refuse = false
    engine.resume()
    expect(engine.status()).toMatchObject({ paused: null, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(feeds()).toBe(1)
    engine.close()
  })
})

describe('other tabs', () => {
  it("hears of another tab's writes, and tells its own", async () => {
    const server = new FakeServer()
    const adapter = createMemoryAdapter()
    const one = await client(server, U1, { adapter, broadcast: true })
    const two = await client(server, U1, { adapter, broadcast: true })
    const heard: unknown[] = []
    two.subscribe((event) => heard.push(event))
    await one.create('tasks', task(id(1)))
    await vi.waitFor(() => expect(heard).toEqual([{ models: ['tasks'], outbox: true }]))
    await vi.waitFor(() => expect(two.status().pending).toBe(1))
    one.close()
    two.close()
  })

  it('broadcasts by default where BroadcastChannel exists, and not where it does not', async () => {
    const posted: unknown[] = []
    class Channel {
      onmessage: unknown = null
      postMessage(message: unknown) {
        posted.push(message)
      }

      close() {}
    }
    vi.stubGlobal('BroadcastChannel', Channel)
    const engine = await client(new FakeServer(), U1, { broadcast: undefined })
    await engine.create('tasks', task(id(1)))
    expect(posted).toHaveLength(1)
    engine.close()
    vi.stubGlobal('BroadcastChannel', undefined)
    const alone = await client(new FakeServer(), U1, { broadcast: undefined })
    await alone.create('tasks', task(id(1)))
    expect(posted).toHaveLength(1)
  })
})

describe('wiping', () => {
  it('refuses while writes are unsent, naming how many, and deletes everything when forced', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', task(id(1)))
    await engine.create('tasks', task(id(2)))
    const refusal = await engine.wipe().catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(PendingWritesError)
    expect(refusal).toMatchObject({
      pending: 2,
      message: 'sync: 2 write(s) have not reached the server; wiping now loses them',
    })
    await engine.wipe({ force: true })
    const fresh = await client(server, U1, { adapter: engine.adapter })
    expect(await fresh.query('tasks')).toEqual([])
    await fresh.wipe()
  })

  it('counts dead letters as unsent', async () => {
    const server = new FakeServer()
    const engine = await client(server)
    await engine.create('tasks', { id: id(1), owner: U1 } as never)
    await engine.sync()
    expect((await engine.pendingCounts()).dead).toBe(1)
    await expect(engine.wipe()).rejects.toMatchObject({ pending: 1 })
  })
})
