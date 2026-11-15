import { randomUUID } from '../http/random'

/*
 * A typed REST client over any OpenAPI document's `paths`, as openapi-typescript emits them. Every
 * type here is read off `paths`: which methods a path has, its path, query and header parameters,
 * its body, and what each status answers. Nothing is generated, and nothing is specific to one
 * server - DRF, allauth's headless API or anything else with a document.
 */

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace'

const UNSAFE: ReadonlySet<string> = new Set(['post', 'put', 'patch', 'delete'])

type Defined<T> = Exclude<T, undefined>

/** The methods `Paths[P]` has. openapi-typescript writes an absent one as `?: never`. */
export type MethodsOf<Paths, P extends keyof Paths> = {
  [M in HttpMethod]: M extends keyof Paths[P] ? ([Defined<Paths[P][M]>] extends [never] ? never : M) : never
}[HttpMethod]

/** The operation object for `method` on `path`. */
export type OperationOf<Paths, P extends keyof Paths, M extends HttpMethod> = Defined<Paths[P][M & keyof Paths[P]]>

type ParametersOf<O> = O extends { parameters: infer X } ? X : {}
type Part<O, K extends string> = K extends keyof ParametersOf<O> ? Defined<ParametersOf<O>[K]> : never

/** `{ K: T }` when T has a required key, `{ K?: T }` when not, and `{ K?: never }` when there is no T. */
type Field<K extends string, T> = [T] extends [never]
  ? { [P in K]?: never }
  : {} extends T
    ? { [P in K]?: T }
    : { [P in K]: T }

type NamedLike<H, N extends string> = { [K in keyof H]: Lowercase<K & string> extends N ? K : never }[keyof H]
type Handled = 'if-match' | 'idempotency-key'
type Unhandled<H> = [H] extends [never]
  ? {}
  : { [K in keyof H as Lowercase<K & string> extends Handled ? never : K]: H[K] }

type HeadersField<H> = Field<'headers', Unhandled<H> & Record<string, string>>

/** `etag` is the `If-Match` header: required exactly when the operation requires that header. */
type EtagField<H> = [H] extends [never]
  ? { etag?: string }
  : [NamedLike<H, 'if-match'>] extends [never]
    ? { etag?: string }
    : {} extends Pick<H, NamedLike<H, 'if-match'>>
      ? { etag?: string }
      : { etag: string }

type Without<T, B extends PropertyKey> = [T] extends [never]
  ? never
  : [keyof Omit<T, B>] extends [never]
    ? never
    : Omit<T, B>

type ContentOf<X> = X extends { content: infer C }
  ? [Defined<C>] extends [never]
    ? never
    : Defined<C>[keyof Defined<C>]
  : never

/** The request body, across every media type the operation takes. */
export type BodyOf<O> = O extends { requestBody?: infer R } ? ContentOf<Defined<R>> : never

type BodyField<O> = [BodyOf<O>] extends [never]
  ? { body?: never }
  : O extends { requestBody: {} }
    ? { body: BodyOf<O> }
    : { body?: BodyOf<O> }

type OkStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226 | '2XX'
type ResponsesOf<O> = O extends { responses: infer R } ? R : {}
type Answer<X> = X extends { content: infer C }
  ? [Defined<C>] extends [never]
    ? undefined
    : Defined<C>[keyof Defined<C>]
  : undefined
type Answers<O, Ok extends boolean> = {
  [S in keyof ResponsesOf<O>]: (S extends OkStatus ? true : false) extends Ok ? Answer<ResponsesOf<O>[S]> : never
}[keyof ResponsesOf<O>]
type OrUnknown<T> = [T] extends [never] ? unknown : T

/** What a 2xx answers. */
export type DataOf<O> = OrUnknown<Answers<O, true>>
/** What any other status answers. */
export type ErrorOf<O> = OrUnknown<Answers<O, false>>

/** openapi-fetch's shape, so a result goes straight to `useAPISubmit` and friends. */
export type RestResult<O> =
  { data: DataOf<O>; error?: never; response: Response } | { data?: never; error: ErrorOf<O>; response: Response }

type Unsafe = 'post' | 'put' | 'patch' | 'delete'

/** Sending no key on purpose, and why - a reason a reader of the call can check. */
export type NoIdempotencyKey = { none: string }

/**
 * Which writes must name their key, a type-level mirror of the client's rule:
 * - `'minted'`: none - `createRestClient` mints a key for a write that names none.
 * - `'every-write'`: every POST, PUT, PATCH and DELETE, whatever the document says.
 * - `'declared'`: the writes whose operation declares an `Idempotency-Key` header.
 */
export type KeyRule = 'minted' | 'every-write' | 'declared'

type Declares<O> = [NamedLike<Part<O, 'header'>, 'idempotency-key'>] extends [never] ? false : true

type KeyField<O, M extends HttpMethod, Rule extends KeyRule> = Rule extends 'minted'
  ? { idempotencyKey?: string | NoIdempotencyKey | false }
  : M extends Unsafe
    ? Rule extends 'every-write'
      ? { idempotencyKey: string | NoIdempotencyKey }
      : Declares<O> extends true
        ? { idempotencyKey: string | NoIdempotencyKey }
        : { idempotencyKey?: string | NoIdempotencyKey }
    : { idempotencyKey?: string | NoIdempotencyKey }

/**
 * What a call takes besides its method and path. `idempotencyKey` is sent on a write; `{ none }`
 * (or, on a loose client, `false`) sends none, and leaving it out sends a fresh one from the client's
 * `generateKey` - or, on a strict client, does not compile.
 */
export type RequestOptions<
  O,
  Bound extends PropertyKey = never,
  M extends HttpMethod = 'get',
  Rule extends KeyRule = 'minted',
> = { signal?: AbortSignal } & KeyField<O, M, Rule> &
  Field<'path', Without<Part<O, 'path'>, Bound>> &
  Field<'query', Part<O, 'query'>> &
  HeadersField<Part<O, 'header'>> &
  EtagField<Part<O, 'header'>> &
  BodyField<O>

/** A trailing options argument, optional exactly when nothing in it is required. */
export type Trailing<I> = {} extends I ? [options?: I] : [options: I]

type SplitLast<S extends string, Head extends string = ''> = S extends `${infer H}{${infer R}`
  ? R extends `${string}{${string}`
    ? SplitLast<R, `${Head}${H}{`>
    : R extends `${infer K}}${infer T}`
      ? T extends '' | '/'
        ? { collection: `${Head}${H}`; key: K; slash: T }
        : never
      : never
  : never

/** A path whose last segment is a parameter: `/v0/tasks/{id}/`, `/projects/{project}/tasks/{id}`. */
export type DetailPath<Paths> = {
  [P in keyof Paths & string]: [SplitLast<P>] extends [never] ? never : P
}[keyof Paths & string]

type Trim<C extends string> = C extends `${infer X}/` ? X : C
type CollectionOf<D extends string> =
  SplitLast<D> extends { collection: infer C extends string; slash: infer T } ? (T extends '/' ? C : Trim<C>) : never
type KeyOf<D extends string> = SplitLast<D>['key']
type Prefix<P extends string> = P extends `${string}/` ? P : `${P}/`

// drf-spectacular declares path parameters on each operation, not on the path item.
type PathParams<Paths, P extends keyof Paths> = OrRecord<
  { [M in MethodsOf<Paths, P>]: Part<OperationOf<Paths, P, M>, 'path'> }[MethodsOf<Paths, P>]
>
type OrRecord<T> = [T] extends [never] ? Record<string, string | number> : T
type IdOf<Paths, D extends keyof Paths & string> =
  KeyOf<D> extends keyof PathParams<Paths, D> ? PathParams<Paths, D>[KeyOf<D>] : string | number
type ParentParams<Paths, D extends keyof Paths & string> = Omit<PathParams<Paths, D>, KeyOf<D>>

/** The sub-paths under `Base`: a DRF `@action`, a nested route. */
export type ActionOf<Paths, Base extends string> = {
  [P in keyof Paths & string]: P extends `${Base}${infer S}` ? (S extends '' | `{${string}` ? never : S) : never
}[keyof Paths & string]

type Call<Paths, P extends keyof Paths, M extends HttpMethod, B extends PropertyKey, Rule extends KeyRule> = (
  ...options: Trailing<RequestOptions<OperationOf<Paths, P, M>, B, M, Rule>>
) => Promise<RestResult<OperationOf<Paths, P, M>>>

type Has<Paths, P, M extends HttpMethod> = P extends keyof Paths
  ? M extends MethodsOf<Paths, P>
    ? true
    : false
  : false

type Collection<Paths, C, B extends PropertyKey, Rule extends KeyRule> = C extends keyof Paths
  ? (Has<Paths, C, 'get'> extends true ? { list: Call<Paths, C, 'get', B, Rule> } : {}) &
      (Has<Paths, C, 'post'> extends true
        ? {
            create: (
              body: BodyOf<OperationOf<Paths, C, 'post'>>,
              ...options: Trailing<Omit<RequestOptions<OperationOf<Paths, C, 'post'>, B, 'post', Rule>, 'body'>>
            ) => Promise<RestResult<OperationOf<Paths, C, 'post'>>>
          }
        : {})
  : {}

type Write<Paths, D extends keyof Paths, M extends HttpMethod, Id, B extends PropertyKey, Rule extends KeyRule> = (
  id: Id,
  body: BodyOf<OperationOf<Paths, D, M>>,
  ...options: Trailing<Omit<RequestOptions<OperationOf<Paths, D, M>, B, M, Rule>, 'body'>>
) => Promise<RestResult<OperationOf<Paths, D, M>>>

type Detail<Paths, D extends keyof Paths & string, Id, B extends PropertyKey, Rule extends KeyRule> = (Has<
  Paths,
  D,
  'get'
> extends true
  ? {
      get: (
        id: Id,
        ...options: Trailing<RequestOptions<OperationOf<Paths, D, 'get'>, B>>
      ) => Promise<RestResult<OperationOf<Paths, D, 'get'>>>
    }
  : {}) &
  (Has<Paths, D, 'patch'> extends true ? { update: Write<Paths, D, 'patch', Id, B, Rule> } : {}) &
  (Has<Paths, D, 'put'> extends true ? { replace: Write<Paths, D, 'put', Id, B, Rule> } : {}) &
  (Has<Paths, D, 'delete'> extends true
    ? {
        remove: (
          id: Id,
          ...options: Trailing<RequestOptions<OperationOf<Paths, D, 'delete'>, B, 'delete', Rule>>
        ) => Promise<RestResult<OperationOf<Paths, D, 'delete'>>>
      }
    : {})

/**
 * One resource: the collection and detail operations its document has - and only those - plus its
 * actions. `list` / `create` on the collection; `get`, `update` (PATCH), `replace` (PUT), `remove`
 * on the detail; `action(id, method, 'sub/path/')` and `collectionAction(method, 'sub/path/')` for
 * anything under either.
 */
export type Resource<Paths, D extends DetailPath<Paths>, Rule extends KeyRule = 'minted'> = Collection<
  Paths,
  CollectionOf<D>,
  keyof ParentParams<Paths, D>,
  Rule
> &
  Detail<Paths, D, IdOf<Paths, D>, keyof PathParams<Paths, D>, Rule> & {
    action<S extends ActionOf<Paths, Prefix<D>>, M extends MethodsOf<Paths, `${Prefix<D>}${S}` & keyof Paths>>(
      id: IdOf<Paths, D>,
      method: M,
      action: S,
      ...options: Trailing<
        RequestOptions<OperationOf<Paths, `${Prefix<D>}${S}` & keyof Paths, M>, keyof PathParams<Paths, D>, M, Rule>
      >
    ): Promise<RestResult<OperationOf<Paths, `${Prefix<D>}${S}` & keyof Paths, M>>>
    collectionAction<
      S extends ActionOf<Paths, Prefix<CollectionOf<D>>>,
      M extends MethodsOf<Paths, `${Prefix<CollectionOf<D>>}${S}` & keyof Paths>,
    >(
      method: M,
      action: S,
      ...options: Trailing<
        RequestOptions<
          OperationOf<Paths, `${Prefix<CollectionOf<D>>}${S}` & keyof Paths, M>,
          keyof ParentParams<Paths, D>,
          M,
          Rule
        >
      >
    ): Promise<RestResult<OperationOf<Paths, `${Prefix<CollectionOf<D>>}${S}` & keyof Paths, M>>>
  }

export interface RestClient<Paths, Rule extends KeyRule = 'minted'> {
  /** Any operation in the document. */
  request<P extends keyof Paths & string, M extends MethodsOf<Paths, P>>(
    method: M,
    path: P,
    ...options: Trailing<RequestOptions<OperationOf<Paths, P, M>, never, M, Rule>>
  ): Promise<RestResult<OperationOf<Paths, P, M>>>
  /**
   * The resource whose detail path is `path`. Its last parameter is the id; any before it - a nested
   * route's parent - are bound here.
   */
  resource<D extends DetailPath<Paths>>(
    path: D,
    ...parent: [keyof ParentParams<Paths, D>] extends [never] ? [] : [params: ParentParams<Paths, D>]
  ): Resource<Paths, D, Rule>
}

export interface RestClientOptions {
  /** Prepended to every path. */
  baseUrl?: string
  /** `createDjangoFetch(...)` for a Django API. The default is the global `fetch`, looked up per call. */
  fetch?: typeof fetch
  /** Sent with every request; a function is called per request - a bearer token that refreshes, say. */
  headers?: HeadersInit | (() => HeadersInit)
  /**
   * The `Idempotency-Key` a write sends when the call names none. Default: a v4 UUID. `null` sends
   * none. A key minted per call only covers that call: a form that may be submitted again after a
   * lost response passes its own, from `useIdempotencyKey` or a submit hook.
   */
  generateKey?: (() => string) | null
}

/** A strict client mints nothing: each write names its key, or `false` on purpose. */
/** The rules a strict client can hold its writes to. */
export type StrictKeyRule = Exclude<KeyRule, 'minted'>

/**
 * A strict client mints nothing. `requireKey` says which writes must name their key: every one (the
 * default), or those whose operation declares the header - which must then be said twice, here and
 * as the type parameter, so the runtime and the types agree.
 */
export type StrictRestClientOptions<Rule extends StrictKeyRule = 'every-write'> = Omit<
  RestClientOptions,
  'generateKey'
> &
  ([Rule] extends ['declared'] ? { requireKey: 'declared' } : { requireKey?: 'every-write' })

type Options = {
  path?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  etag?: string
  idempotencyKey?: string | NoIdempotencyKey | false
  body?: unknown
  signal?: AbortSignal
}

function fill(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined || value === null) throw new TypeError(`rest: ${path} needs its "${name}"`)
    return encodeURIComponent(String(value))
  })
}

// Repeated keys for an array, as DRF's filters read them; undefined and null are left out.
function search(query: Record<string, unknown> = {}): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      params.append(name, item instanceof Date ? item.toISOString() : String(item))
    }
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
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

/** The parts of a detail path its resource needs: where the collection is, and the id's name. */
function split(path: string) {
  // Greedy, so the head runs to the last parameter; then only an optional slash may follow it.
  const match = /(.*)\{([^{}]+)\}(\/?)$/.exec(path)
  if (match === null) throw new TypeError(`rest: ${path} does not end in a parameter`)
  const [, head, key, slash] = match
  const trimmed = head.replace(/\/$/, '')
  return {
    key,
    collection: slash === '/' ? head : trimmed,
    collectionPrefix: `${trimmed}/`,
    detailPrefix: slash === '/' ? path : `${path}/`,
  }
}

/**
 * A typed client for `Paths`. A write with no `idempotencyKey` gets a fresh one from `generateKey`;
 * `createStrictRestClient` refuses it instead.
 */
export function createRestClient<Paths extends object>(options: RestClientOptions = {}): RestClient<Paths> {
  const generateKey = options.generateKey === undefined ? () => randomUUID('createRestClient') : options.generateKey
  return build(options, (_method, _path, given) => {
    if (typeof given === 'string') return given
    return given === undefined ? generateKey?.() : undefined
  })
}

/**
 * `createRestClient`, except that a write must name its `Idempotency-Key`: leaving it out does not
 * compile, and - for a caller the types cannot see - throws before anything is sent. `{ none:
 * reason }` sends none, on purpose and saying why. Pair it with `useIdempotencyKey`, whose key lasts
 * the attempt, not the call.
 *
 * `createStrictRestClient<paths, 'declared'>({ requireKey: 'declared' })` requires a key only where
 * the operation declares the header. The document is not there at runtime, so that rule is the
 * types' alone: an untyped caller's missing key then goes out as no key, unrefused.
 */
export function createStrictRestClient<Paths extends object, Rule extends StrictKeyRule = 'every-write'>(
  ...[options]: [Rule] extends ['declared'] ? [StrictRestClientOptions<Rule>] : [StrictRestClientOptions<Rule>?]
): RestClient<Paths, Rule> {
  const settings: Omit<RestClientOptions, 'generateKey'> & { requireKey?: StrictKeyRule } = options ?? {}
  return build(settings, (method, path, given) => {
    if (typeof given === 'string') return given
    if (given === undefined && settings.requireKey === 'declared') return undefined
    if (typeof given === 'object' && given !== null && typeof given.none === 'string' && given.none.trim() !== '') {
      return undefined
    }
    throw new TypeError(
      `rest: ${method.toUpperCase()} ${path} names no idempotencyKey - pass one, or { none: 'the reason' }`
    )
  })
}

function build<Paths, Rule extends KeyRule>(
  options: Omit<RestClientOptions, 'generateKey'>,
  keyOf: (method: string, path: string, given: Options['idempotencyKey']) => string | undefined
): RestClient<Paths, Rule> {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const send = options.fetch ?? ((input, init) => fetch(input, init))

  async function request(method: string, path: string, init: Options = {}) {
    const headers = new Headers(typeof options.headers === 'function' ? options.headers() : options.headers)
    for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value)
    if (init.etag !== undefined) headers.set('If-Match', init.etag)
    if (UNSAFE.has(method)) {
      const key = keyOf(method, path, init.idempotencyKey)
      if (key !== undefined) headers.set('Idempotency-Key', key)
    }
    let body: BodyInit | undefined
    if (init.body !== undefined) {
      if (isRaw(init.body)) body = init.body
      else {
        body = JSON.stringify(init.body)
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      }
    }
    const response = await send(baseUrl + fill(path, init.path ?? {}) + search(init.query), {
      method: method.toUpperCase(),
      headers,
      body,
      signal: init.signal,
    })
    const payload = await read(response)
    return response.ok ? { data: payload, response } : { error: payload ?? '', response }
  }

  function resource(path: string, parent: Record<string, unknown> = {}) {
    const { key, collection, collectionPrefix, detailPrefix } = split(path)
    const under = (init: Options | undefined, params: Record<string, unknown>): Options => ({
      ...init,
      path: { ...init?.path, ...params },
    })
    const at = (id: unknown) => ({ ...parent, [key]: id })
    return {
      list: (init?: Options) => request('get', collection, under(init, parent)),
      create: (body: unknown, init?: Options) => request('post', collection, { ...under(init, parent), body }),
      get: (id: unknown, init?: Options) => request('get', path, under(init, at(id))),
      update: (id: unknown, body: unknown, init?: Options) => request('patch', path, { ...under(init, at(id)), body }),
      replace: (id: unknown, body: unknown, init?: Options) => request('put', path, { ...under(init, at(id)), body }),
      remove: (id: unknown, init?: Options) => request('delete', path, under(init, at(id))),
      action: (id: unknown, method: string, action: string, init?: Options) =>
        request(method, detailPrefix + action, under(init, at(id))),
      collectionAction: (method: string, action: string, init?: Options) =>
        request(method, collectionPrefix + action, under(init, parent)),
    }
  }

  return { request, resource } as unknown as RestClient<Paths, Rule>
}
