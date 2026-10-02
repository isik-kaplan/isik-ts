// @vitest-environment node
import { spawn } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { createServer } from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for `@isikk/core/next/config` against a real Next build.
 *
 * Everything here is something a unit test structurally cannot observe: whether Next's bundler
 * resolves the export conditions the way the package assumes, and whether values are genuinely
 * read per request rather than frozen into the build. `tests/build.test.ts` can prove the emitted
 * files have the right shape; only a real build can prove Next agrees about what that shape means.
 *
 * Deliberately no assertions about Next's own internals - no chunk layout, no `<head>` ordering,
 * no snapshotting of framework-generated markup. Those change between patch releases and would
 * make this suite rot. Every assertion below is about *our* payload: the values we injected, under
 * the key the app chose, reflecting the environment the server was started with.
 *
 * The fixture consumes a packed tarball extracted into its own `node_modules`, not a path alias.
 * That is the whole point: resolution has to go through the real `exports` map, or the conditions
 * being tested are bypassed and this suite proves nothing.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(root, 'fixtures/next-app')
const installed = path.join(fixture, 'node_modules/@isikk/core')

const GLOBAL_KEY = '__FIXTURE_CONFIG__'
const BUILD_TIMEOUT = 300_000

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** An env with every fixture variable cleared, so "unset" means unset regardless of the shell. */
function envWithout(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('PUBLIC__')) delete env[key]
  }
  return env
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

interface Server {
  get: (pathname: string) => Promise<string>
  getJSON: (pathname: string) => Promise<unknown>
  stop: () => void
}

/** Boots `next start` with `vars` in its environment, against the already-built fixture. */
async function serve(vars: Record<string, string>): Promise<Server> {
  const port = await freePort()
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: fixture,
    env: { ...envWithout(), ...vars },
  })

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  for (;;) {
    if (Date.now() > deadline) {
      child.kill('SIGKILL')
      throw new Error(`next start did not become ready on port ${port}`)
    }
    try {
      await fetch(base, { signal: AbortSignal.timeout(2000) })
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  return {
    get: async (pathname) => (await fetch(`${base}${pathname}`)).text(),
    getJSON: async (pathname) => (await fetch(`${base}${pathname}`)).json(),
    stop: () => child.kill('SIGKILL'),
  }
}

/** Reads the text content of `<dd id="...">` out of the served HTML. */
function readField(html: string, id: string): string | undefined {
  return new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]
}

let buildWithoutEnv: RunResult
const servers: Server[] = []

beforeAll(async () => {
  // 1. Build and pack the package exactly as npm would ship it.
  const built = await run('npm', ['run', 'build'], { cwd: root })
  expect(built.code, `npm run build failed:\n${built.stderr}`).toBe(0)

  const packDir = path.join(root, 'fixtures/.pack')
  rmSync(packDir, { recursive: true, force: true })
  mkdirSync(packDir, { recursive: true })
  const packed = await run('npm', ['pack', '--pack-destination', packDir, '--silent'], { cwd: root })
  expect(packed.code, `npm pack failed:\n${packed.stderr}`).toBe(0)
  const tarball = path.join(packDir, packed.stdout.trim().split('\n').pop()!)

  // 2. Install it into the fixture, so resolution goes through the published exports map.
  rmSync(installed, { recursive: true, force: true })
  mkdirSync(installed, { recursive: true })
  const extracted = await run('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1'], { cwd: root })
  expect(extracted.code, `extracting the tarball failed:\n${extracted.stderr}`).toBe(0)

  // 3. Build the fixture with none of the config variables set. Captured rather than asserted
  //    here so the assertion reads as its own test below.
  rmSync(path.join(fixture, '.next'), { recursive: true, force: true })
  buildWithoutEnv = await run('npx', ['next', 'build'], { cwd: fixture, env: envWithout() })
}, BUILD_TIMEOUT)

afterAll(() => {
  for (const server of servers) server.stop()
})

describe('next build', () => {
  it('succeeds with none of the config variables set', () => {
    // The claim that decouples "can this build" from "is this configured". Resolution is deferred
    // until something reads the config, so page-data collection never touches the environment.
    expect(buildWithoutEnv.stdout + buildWithoutEnv.stderr).not.toMatch(/Environment variable .* not found/)
    expect(buildWithoutEnv.code, `next build failed:\n${buildWithoutEnv.stdout}\n${buildWithoutEnv.stderr}`).toBe(0)
  })

  it('installed a real package, not a path alias', () => {
    // If this were aliased to src/, the export conditions under test would never be consulted.
    expect(existsSync(path.join(installed, 'package.json'))).toBe(true)
    expect(existsSync(path.join(installed, 'dist/next/config/browser.js'))).toBe(true)
  })
})

describe('one build, many environments', () => {
  it('serves the environment the server was started with, without rebuilding', async () => {
    const first = await serve({ PUBLIC__API_URL: 'https://one.example.com', PUBLIC__RETRIES: '7' })
    servers.push(first)
    const firstHTML = await first.get('/')
    first.stop()

    const second = await serve({ PUBLIC__API_URL: 'https://two.example.com', PUBLIC__RETRIES: '9' })
    servers.push(second)
    const secondHTML = await second.get('/')
    second.stop()

    // Same .next directory for both. This is the entire reason the module exists: with
    // NEXT_PUBLIC_*, changing either value would need a rebuild and a new image.
    expect(readField(firstHTML, 'server-api-url')).toBe('https://one.example.com')
    expect(readField(secondHTML, 'server-api-url')).toBe('https://two.example.com')
    expect(readField(firstHTML, 'server-retries')).toBe('7 (number)')
    expect(readField(secondHTML, 'server-retries')).toBe('9 (number)')
  })

  it('applies missingDefault at runtime for variables that are not set', async () => {
    const server = await serve({ PUBLIC__API_URL: 'https://defaults.example.com' })
    servers.push(server)
    const html = await server.get('/')
    server.stop()

    // RETRIES and NESTED__LABEL are unset; their casters carry missingDefault.
    expect(readField(html, 'server-retries')).toBe('1 (number)')
    expect(readField(html, 'client-nested-label')).toBe('unset')
  })
})

describe('export conditions, as Next actually resolves them', () => {
  it('gives a client component the server build during SSR and the browser build in the bundle', async () => {
    const server = await serve({ PUBLIC__API_URL: 'https://ssr.example.com', PUBLIC__RETRIES: '4' })
    servers.push(server)
    const html = await server.get('/')
    server.stop()

    // The open question this fixture was built to answer. A client component's SSR pass has to
    // resolve the `node` condition and read process.env - there is no injected global on the
    // server. Had it resolved `browser` instead, this would be a render error, not a value.
    expect(readField(html, 'client-api-url')).toBe('https://ssr.example.com')
    // Cast on the server, carried as JSON, still a number rather than a re-parsed string.
    expect(readField(html, 'client-retries')).toBe('4 (number)')
    // Deliberately not asserting which chunk file the browser build landed in - those names are
    // content-hashed and are exactly the kind of Next internal this suite stays away from.
  })

  it('gives an edge route the server build, not the browser one', async () => {
    const server = await serve({ PUBLIC__API_URL: 'https://edge.example.com', PUBLIC__RETRIES: '5' })
    servers.push(server)
    const payload = await server.getJSON('/api/edge')
    server.stop()

    // Next's edge compiler sets `browser` alongside `edge-light`/`worker`. If `browser` won here,
    // the handler would have read a global that does not exist in that runtime.
    expect(payload).toEqual({ API_URL: 'https://edge.example.com', RETRIES: 5 })
  })
})

describe('the injected payload', () => {
  it('lands in the document under the key the app chose, carrying the cast values', async () => {
    const server = await serve({
      PUBLIC__API_URL: 'https://payload.example.com',
      PUBLIC__RETRIES: '3',
      PUBLIC__NESTED__LABEL: 'from-env',
    })
    servers.push(server)
    const html = await server.get('/')
    server.stop()

    expect(html).toContain(GLOBAL_KEY)
    expect(html).toContain('https://payload.example.com')
    expect(html).toContain('from-env')
    // No package-chosen name anywhere in the served document.
    expect(html).not.toMatch(/isik/i)
  })

  it('escapes a value that would otherwise close the script tag', async () => {
    const server = await serve({
      PUBLIC__API_URL: 'https://x.example.com',
      PUBLIC__NESTED__LABEL: '</script><script>window.__PWNED__=1</script>',
    })
    servers.push(server)
    const html = await server.get('/')
    server.stop()

    // The string does appear in the document - three times, all of them inert: escaped inside our
    // script, HTML-escaped inside the rendered <dd>, and escaped again in the RSC payload. What
    // matters is that it never appears as *markup*. So: find the script element carrying our
    // payload and require its body to contain no raw `<` at all. A `[^<]*` body that still holds
    // the whole key is itself the proof - had the escaping failed, `</script>` would have ended
    // the element early and this match would come up empty.
    const injected = new RegExp(`<script>([^<]*${GLOBAL_KEY}[^<]*)</script>`).exec(html)?.[1]

    expect(injected, 'no intact config script element in the document').toBeDefined()
    expect(injected).toContain('\\u003c/script')
    expect(injected).not.toContain('<')
  })
})
