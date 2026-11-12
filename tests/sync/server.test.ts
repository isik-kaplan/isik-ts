import { describe, expect, it } from 'vitest'

import { Bindings, loadFixtures } from './support/fixtures'
import { FakeServer } from './support/server'

// The fake server the client is tested against must itself pass the protocol fixtures - the same ones
// isik's server runs - or the client's tests would prove things about a protocol nobody speaks.

const fixtures = loadFixtures()

describe('the fake server', () => {
  it('has fixtures to pass', () => {
    expect(fixtures.length).toBeGreaterThan(20)
  })

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))('passes %s', (_, fixture) => {
    const server = new FakeServer()
    const { user, memberships, rows, push } = fixture.given
    for (const scope of memberships)
      server.memberships.set(user as string, new Set([...server.scopesOf(user as string), scope]))
    for (const [model, list] of Object.entries(rows)) for (const row of list) server.create(model, row)
    server.push = { max_entries: push?.max_entries ?? null, max_bytes: push?.max_bytes ?? null }

    const bindings = new Bindings()
    fixture.steps.forEach((step, i) => {
      if ('act' in step) {
        const [[kind, args]] = Object.entries(step.act)
        if (kind === 'create') server.create(args.model as string, args.row as Record<string, unknown>)
        if (kind === 'update')
          server.update(args.model as string, args.id as string, args.set as Record<string, unknown>)
        if (kind === 'delete') server.delete(args.model as string, args.id as string)
        if (kind === 'grant') server.grant(user as string, args.scope as string)
        if (kind === 'revoke') server.revoke(user as string, args.scope as string)
        if (kind === 'expire') server.expire()
        return
      }
      const request = bindings.fill(step.request)
      const response = server.handle(user, request)
      try {
        bindings.match(step.response.status, response.status, 'status')
        for (const [name, value] of Object.entries(step.response.headers ?? {})) {
          bindings.match(value, response.headers[name], `headers.${name}`)
        }
        if ('body' in step.response) bindings.match(step.response.body, response.body, 'body')
      } catch (error) {
        throw new Error(`step ${i}: ${(error as Error).message}\n${JSON.stringify(response, null, 1)}`)
      }
    })
  })
})

describe('the fixture matcher', () => {
  it('binds placeholders, refuses a rebinding, a reused etag name, a missing or extra key and a wrong value', () => {
    const bindings = new Bindings()
    bindings.match({ a: '$etag:x', b: '$cursor:1' }, { a: '"1"', b: 'c' })
    expect(() => bindings.match('$etag:x', '"2"')).toThrow()
    expect(() => bindings.match('$etag:y', '"1"')).toThrow()
    expect(() => bindings.match({ a: 1 }, { a: 1, b: 2 })).toThrow()
    expect(() => bindings.match({ a: 1, b: 2 }, { a: 1 })).toThrow()
    expect(() => bindings.match([1, 2], [2, 1])).toThrow()
    expect(() => bindings.match(200, 201)).toThrow()
    bindings.match('$any', { anything: true })
    expect(bindings.fill({ q: ['$cursor:1'] })).toEqual({ q: ['c'] })
  })
})
