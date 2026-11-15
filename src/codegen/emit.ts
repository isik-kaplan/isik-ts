import { type KeyRule, type Member, type Model, type Operation, type Resource, keyModeOf } from './model'

/*
 * Writes the client: one self-contained TypeScript file that imports only the types openapi-typescript
 * wrote from the same document, and needs nothing at runtime but `fetch`.
 */

const str = (value: string) => JSON.stringify(value)

/** A property name, quoted only when it has to be. */
const prop = (name: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name))

function keyType(rule: KeyRule): string {
  return rule === 'minted' ? 'string | NoIdempotencyKey | false' : 'string | NoIdempotencyKey'
}

function optionsOf(operation: Operation, covered: string[], rule: KeyRule): { type: string; required: boolean } {
  const ref = `${str(operation.path)}, ${str(operation.method)}`
  const fields: string[] = []
  let required = false
  const field = (name: string, type: string, needed: boolean) => {
    fields.push(`${name}${needed ? '' : '?'}: ${type}`)
    required ||= needed
  }
  const extra = operation.pathParameters.filter((name) => !covered.includes(name))
  if (extra.length > 0) field('path', `Pick<PathOf<${ref}>, ${extra.map(str).join(' | ')}>`, true)
  if (operation.query !== null) field('query', `QueryOf<${ref}>`, operation.query.required)
  const handled = [operation.etag?.name, operation.declaresKey?.name].filter((name) => name !== undefined)
  if (operation.headers === null) field('headers', 'Record<string, string>', false)
  else {
    const declared =
      handled.length === 0 ? `HeadersOf<${ref}>` : `Omit<HeadersOf<${ref}>, ${handled.map(str).join(' | ')}>`
    field('headers', `${declared} & Record<string, string>`, operation.headers.required)
  }
  if (operation.etag !== null) field('etag', 'string', operation.etag.required)
  const mode = keyModeOf(operation, rule)
  if (mode !== 'none') field('idempotencyKey', keyType(rule), mode === 'require')
  field('signal', 'AbortSignal', false)
  return { type: `{ ${fields.join('; ')} }`, required }
}

function memberOf(resource: Resource, member: Member, rule: KeyRule, filled: string[]): string {
  const { operation } = member
  const ref = `${str(operation.path)}, ${str(operation.method)}`
  const positional = [...resource.parents, ...(member.id === null ? [] : [member.id])]
  const names = positional.map((name, index) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `p${index}`))
  const args = positional.map((name, index) => `${names[index]}: PathOf<${ref}>[${str(name)}]`)
  if (operation.body) args.push(`body: BodyOf<${ref}>`)
  const options = optionsOf(operation, [...filled, ...positional], rule)
  args.push(`options${options.required ? '' : '?'}: ${options.type}`)
  const path = positional.map((name, index) => (prop(name) === names[index] ? name : `${prop(name)}: ${names[index]}`))
  const spread = operation.pathParameters.some((name) => ![...filled, ...positional].includes(name))
    ? '...options.path, '
    : ''
  const init = [
    '...options',
    ...(path.length === 0 ? [] : [`path: { ${spread}${path.join(', ')} }`]),
    ...(operation.body ? ['body'] : []),
  ]
  const mode = keyModeOf(operation, rule)
  return [
    `      /** ${operation.method.toUpperCase()} ${operation.path} */`,
    `      ${prop(member.name)}: (`,
    ...args.map((arg) => `        ${arg},`),
    `      ): Promise<Result<${ref}>> =>`,
    `        call(${str(operation.method)}, ${str(operation.path)}, { ${init.join(', ')} }, ${str(mode)}),`,
  ].join('\n')
}

const RUNTIME = String.raw`
type Op<P extends keyof paths, M extends keyof paths[P]> = NonNullable<paths[P][M]>
type Part<O, K extends string> = O extends { parameters: infer X } ? (K extends keyof X ? NonNullable<X[K]> : never) : never
export type PathOf<P extends keyof paths, M extends keyof paths[P]> = Part<Op<P, M>, 'path'>
export type QueryOf<P extends keyof paths, M extends keyof paths[P]> = Part<Op<P, M>, 'query'>
export type HeadersOf<P extends keyof paths, M extends keyof paths[P]> = Part<Op<P, M>, 'header'>
type Content<X> = X extends { content: infer C } ? ([NonNullable<C>] extends [never] ? undefined : NonNullable<C>[keyof NonNullable<C>]) : undefined
/** The request body, across every media type the operation takes. */
export type BodyOf<P extends keyof paths, M extends keyof paths[P]> = Exclude<
  Op<P, M> extends { requestBody?: infer R } ? Content<NonNullable<R>> : never,
  undefined
>
type OkStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226 | '2XX'
type Responses<O> = O extends { responses: infer R } ? R : {}
type Answers<O, Ok extends boolean> = {
  [S in keyof Responses<O>]: (S extends OkStatus ? true : false) extends Ok ? Content<Responses<O>[S]> : never
}[keyof Responses<O>]
type OrUnknown<T> = [T] extends [never] ? unknown : T
/** What a 2xx answers. */
export type DataOf<P extends keyof paths, M extends keyof paths[P]> = OrUnknown<Answers<Op<P, M>, true>>
/** What any other status answers. */
export type ErrorOf<P extends keyof paths, M extends keyof paths[P]> = OrUnknown<Answers<Op<P, M>, false>>
/** openapi-fetch's shape, so a result goes straight to a submit hook. */
export type Result<P extends keyof paths, M extends keyof paths[P]> =
  | { data: DataOf<P, M>; error?: never; response: Response }
  | { data?: never; error: ErrorOf<P, M>; response: Response }
/** Sending no Idempotency-Key on purpose, and why - a reason a reader of the call can check. */
export type NoIdempotencyKey = { none: string }
/** What onRequest is told: a request starting, and ending with a status - or failing with no answer. */
export type RequestEvent =
  | { phase: 'start'; id: number; method: string; path: string; url: string; idempotencyKey?: string; etag?: string }
  | { phase: 'end'; id: number; method: string; path: string; url: string; status: number; ok: boolean; ms: number; requestId: string | null }
  | { phase: 'error'; id: number; method: string; path: string; url: string; ms: number; error: unknown }

type Init = {
  path?: Record<string, unknown>
  query?: object
  headers?: Record<string, string>
  etag?: string
  idempotencyKey?: string | NoIdempotencyKey | false
  body?: unknown
  signal?: AbortSignal
}
type KeyMode = 'require' | 'optional' | 'mint' | 'none'

function fill(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined || value === null) throw new TypeError(path + ' needs its "' + name + '"')
    return encodeURIComponent(String(value))
  })
}

// Repeated keys for an array, as DRF's filters read them; undefined and null are left out.
function search(query: object = {}): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      params.append(name, item instanceof Date ? item.toISOString() : String(item))
    }
  }
  const text = params.toString()
  return text === '' ? '' : '?' + text
}

function isRaw(body: unknown): body is BodyInit {
  return (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

async function read(response: Response): Promise<unknown> {
  // A 204, a 304 and a HEAD carry no body, so they read as empty too.
  const text = await response.text()
  if (text === '') return undefined
  if (!/[/+]json\b/i.test(String(response.headers.get('Content-Type')))) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
`

const MINT = String.raw`
/**
 * A v4 UUID. randomUUID exists only in a secure context, so a dev stack on plain http has none;
 * getRandomValues exists wherever crypto does.
 */
function randomUUID(): string {
  const crypto = globalThis.crypto as Partial<Crypto> | undefined
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new TypeError('this runtime has neither crypto.randomUUID nor crypto.getRandomValues - pass generateKey')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
`

function clientOptions(rule: KeyRule, prefixParameters: string[]): string {
  return [
    'export interface ClientOptions {',
    '  /** Prepended to every path. */',
    '  baseUrl?: string',
    '  /** createDjangoFetch(...) from @isikk/core for a Django API. Default: the global fetch, looked up per call. */',
    '  fetch?: typeof fetch',
    '  /** Sent with every request; a function is called per request - a bearer token that refreshes, say. */',
    '  headers?: HeadersInit | (() => HeadersInit)',
    '  /** Told when each request starts and ends - logRequests(createDebug(...)) from @isikk/core/debug logs them. */',
    '  onRequest?: (event: RequestEvent) => void',
    ...(prefixParameters.length === 0
      ? []
      : [
          '  /** The parameters in the prefix every path shares, filled into every call. */',
          `  pathParams: { ${prefixParameters.map((name) => `${prop(name)}: string | number`).join('; ')} }`,
        ]),
    ...(rule === 'minted'
      ? [
          '  /** The key a write sends when the call names none. Default: a v4 UUID. Null sends none. */',
          '  generateKey?: (() => string) | null',
        ]
      : []),
    '}',
  ].join('\n')
}

function keyOf(rule: KeyRule): string {
  const mint =
    rule === 'minted'
      ? [
          "    if (mode === 'mint') {",
          "      if (given === false || (typeof given === 'object' && given !== null)) return undefined",
          '      return generateKey === null ? undefined : (generateKey ?? randomUUID)()',
          '    }',
        ]
      : []
  return [
    "  function keyOf(method: string, path: string, given: Init['idempotencyKey'], mode: KeyMode): string | undefined {",
    "    if (mode === 'none') return undefined",
    "    if (typeof given === 'string') return given",
    ...mint,
    "    if (given === undefined && mode === 'optional') return undefined",
    "    if (typeof given === 'object' && given !== null && typeof given.none === 'string' && given.none.trim() !== '') {",
    '      return undefined',
    '    }',
    "    throw new TypeError(method.toUpperCase() + ' ' + path + \" names no idempotencyKey - pass one, or { none: 'the reason' }\")",
    '  }',
  ].join('\n')
}

const CALL = String.raw`
  async function call(method: string, path: string, init: Init, mode: KeyMode): Promise<never> {
    const headers = new Headers(typeof options.headers === 'function' ? options.headers() : options.headers)
    for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value)
    if (init.etag !== undefined) headers.set('If-Match', init.etag)
    const key = keyOf(method, path, init.idempotencyKey, mode)
    if (key !== undefined) headers.set('Idempotency-Key', key)
    let body: BodyInit | undefined
    if (init.body !== undefined) {
      if (isRaw(init.body)) body = init.body
      else {
        body = JSON.stringify(init.body)
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      }
    }
    const url = baseUrl + fill(path, PATH_PARAMS) + search(init.query)
    const id = (requests += 1)
    tell({ phase: 'start', id, method, path, url, idempotencyKey: key, etag: init.etag })
    const started = Date.now()
    let response: Response
    try {
      response = await send(url, { method: method.toUpperCase(), headers, body, signal: init.signal })
    } catch (error) {
      tell({ phase: 'error', id, method, path, url, ms: Date.now() - started, error })
      throw error
    }
    const payload = await read(response)
    const requestId = response.headers.get('X-Request-Id')
    tell({ phase: 'end', id, method, path, url, status: response.status, ok: response.ok, ms: Date.now() - started, requestId })
    return (response.ok ? { data: payload, response } : { error: payload ?? '', response }) as never
  }

  // An observer that throws never changes what the request does.
  function tell(event: RequestEvent): void {
    try {
      options.onRequest?.(event)
    } catch {}
  }
`

export interface EmitOptions {
  /** Where the openapi-typescript output is, as the client file imports it. */
  types: string
  keys: KeyRule
  /** Shown in the header: where the document came from. */
  source?: string
}

export function emit(model: Model, { types, keys, source }: EmitOptions): string {
  const resources = model.resources.map(
    (resource) =>
      `    ${prop(resource.name)}: {\n${resource.members.map((member) => memberOf(resource, member, keys, model.prefixParameters)).join('\n')}\n    },`
  )
  return [
    '// Generated by isikk-gen-client from @isikk/core' +
      (source === undefined ? '' : ` - ${source}`) +
      '. Do not edit.',
    `// Idempotency keys: ${keys}.`,
    '/* eslint-disable */',
    `import type { paths } from ${str(types)}`,
    RUNTIME.trimEnd(),
    ...(keys === 'minted' ? [MINT.trimEnd()] : []),
    '',
    clientOptions(keys, model.prefixParameters),
    '',
    `export function createClient(options: ClientOptions${model.prefixParameters.length === 0 ? ' = {}' : ''}) {`,
    "  const baseUrl = (options.baseUrl ?? '').replace(/\\/$/, '')",
    '  const send = options.fetch ?? ((input, init) => fetch(input, init))',
    '  let requests = 0',
    ...(keys === 'minted' ? ['  const generateKey = options.generateKey'] : []),
    keyOf(keys),
    CALL.trimEnd().replace(
      'PATH_PARAMS',
      model.prefixParameters.length === 0 ? 'init.path ?? {}' : '{ ...options.pathParams, ...init.path }'
    ),
    '',
    '  return {',
    ...resources,
    '  }',
    '}',
    '',
    'export type Client = ReturnType<typeof createClient>',
    '',
  ].join('\n')
}
