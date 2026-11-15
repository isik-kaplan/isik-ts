/*
 * Reads an OpenAPI document into resources: which paths make a collection, which its detail, and
 * which sub-paths are its actions, each named for a call site. Nothing here writes code.
 */

export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export type Method = (typeof METHODS)[number]

const UNSAFE: ReadonlySet<Method> = new Set(['post', 'put', 'patch', 'delete'])

export type KeyRule = 'every-write' | 'declared' | 'minted'

type Json = Record<string, unknown>

export interface Parameter {
  name: string
  in: string
  required: boolean
}

/** One operation, as a generated method needs it. */
export interface Operation {
  path: string
  method: Method
  /** Its path parameters, in the order the path names them. */
  pathParameters: string[]
  query: { required: boolean } | null
  /** Declared headers other than If-Match and Idempotency-Key, by their declared names. */
  headers: { names: string[]; required: boolean } | null
  /** The declared name of `If-Match`, and whether it is required. */
  etag: { name: string; required: boolean } | null
  /** Whether the operation declares an `Idempotency-Key` header, under any case. */
  declaresKey: { name: string } | null
  body: boolean
}

export type Kind = 'collection' | 'detail' | 'detailAction' | 'collectionAction'

export interface Member {
  name: string
  kind: Kind
  operation: Operation
  /** The detail path's parameter, for the members that take an id. */
  id: string | null
}

export interface Resource {
  name: string
  collection: string
  /** Parameters of the collection path - a nested route's parents - passed before the id. */
  parents: string[]
  members: Member[]
}

export interface Model {
  resources: Resource[]
  /** Parameters in the prefix every path shares, which the client fills on every call. */
  prefixParameters: string[]
  warnings: string[]
}

const PARAMETER = /^\{([^{}]+)\}$/

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '')
}

function parametersOf(path: string): string[] {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
}

function endsInParameter(path: string): boolean {
  return /\{[^{}]+\}\/?$/.test(path)
}

/** The path one segment up, in the same slash style: `/a/b/` is `/a/`, `/a/b` is `/a`. */
export function parentOf(path: string): string | null {
  const slash = path.endsWith('/')
  const trimmed = slash ? path.slice(0, -1) : path
  const cut = trimmed.lastIndexOf('/')
  if (cut < 0) return null
  return trimmed.slice(0, cut) + (slash ? '/' : '') || '/'
}

/** `rotate-secret` is `rotateSecret`; `read_all/now` is `readAllNow`; a leading digit gets a `_`. */
export function camel(words: string[]): string {
  const parts = words.flatMap((word) => word.split(/[^A-Za-z0-9]/)).filter((part) => part !== '')
  const joined = parts
    .map((part, index) => (index === 0 ? part[0].toLowerCase() : part[0].toUpperCase()) + part.slice(1))
    .join('')
  return /^[0-9]/.test(joined) ? `_${joined}` : joined
}

function pascal(words: string[]): string {
  const name = camel(words)
  return name[0].toUpperCase() + name.slice(1)
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Follows a local `$ref` (`#/components/parameters/Page`); anything else is returned as it is. */
function resolve(document: Json, value: unknown): unknown {
  if (!isObject(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value
  let target: unknown = document
  for (const key of value.$ref.slice(2).split('/')) {
    const name = key.replace(/~1/g, '/').replace(/~0/g, '~')
    target = isObject(target) ? target[name] : undefined
  }
  if (target === undefined) throw new TypeError(`codegen: ${value.$ref} does not resolve`)
  return resolve(document, target)
}

function parametersIn(document: Json, list: unknown): Parameter[] {
  // Stryker disable next-line ArrayDeclaration: a filler entry has no name or place, so it is never read
  if (!Array.isArray(list)) return []
  return list.map((entry) => {
    const parameter = resolve(document, entry) as Json
    return { name: String(parameter.name), in: String(parameter.in), required: parameter.required === true }
  })
}

function operationOf(document: Json, path: string, method: Method, item: Json, raw: Json): Operation {
  // An operation's parameter replaces the path item's of the same name and place.
  const merged = new Map<string, Parameter>()
  for (const parameter of [...parametersIn(document, item.parameters), ...parametersIn(document, raw.parameters)]) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter)
  }
  const all = [...merged.values()]
  const queries = all.filter((parameter) => parameter.in === 'query')
  const headers = all.filter((parameter) => parameter.in === 'header')
  const named = (wanted: string) => headers.find((header) => header.name.toLowerCase() === wanted)
  const etag = named('if-match')
  const key = named('idempotency-key')
  const others = headers.filter((header) => header !== etag && header !== key)
  return {
    path,
    method,
    pathParameters: parametersOf(path),
    query: queries.length === 0 ? null : { required: queries.some((query) => query.required) },
    headers:
      others.length === 0
        ? null
        : { names: others.map((header) => header.name), required: others.some((header) => header.required) },
    etag: etag === undefined ? null : { name: etag.name, required: etag.required },
    declaresKey: key === undefined ? null : { name: key.name },
    body: raw.requestBody !== undefined,
  }
}

/** Whether a call to `operation` must name its key, may, or gets one minted. Safe methods take none. */
export function keyModeOf(operation: Operation, rule: KeyRule): 'require' | 'optional' | 'mint' | 'none' {
  if (!UNSAFE.has(operation.method)) return 'none'
  if (rule === 'minted') return 'mint'
  if (rule === 'every-write' || operation.declaresKey !== null) return 'require'
  return 'optional'
}

const COLLECTION_NAMES: Partial<Record<Method, string>> = { get: 'list', post: 'create' }
const DETAIL_NAMES: Partial<Record<Method, string>> = { get: 'get', patch: 'update', put: 'replace', delete: 'remove' }

/**
 * The resources a document's paths make:
 * - a path ending in a parameter is a detail, and the path above it a collection;
 * - a path under a detail is that detail's action, and one under a collection its collection action;
 * - any other path is a resource of its own, whose methods are named for their HTTP verbs.
 */
export function modelOf(document: unknown, stripPrefix?: string): Model {
  if (!isObject(document) || !isObject(document.paths)) {
    throw new TypeError('codegen: the document has no `paths` - is it an OpenAPI document?')
  }
  const root = document
  // Stryker disable next-line EqualityOperator: two keys of one object are never equal
  const paths = Object.keys(document.paths).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
  const operations = new Map<string, Operation[]>()
  for (const path of paths) {
    const item = resolve(root, (document.paths as Json)[path]) as Json
    const found: Operation[] = []
    for (const method of METHODS) {
      const raw = item[method]
      if (isObject(raw)) found.push(operationOf(root, path, method, item, raw))
    }
    operations.set(path, found)
  }

  // Resources are read from what follows the prefix every path shares. A parameter in that prefix -
  // allauth's `{client}` - is the client's to fill once, not every call's.
  const prefix = normalized(stripPrefix) ?? commonPrefix(paths)
  const local = (path: string) => (path.startsWith(prefix) ? path.slice(prefix.length - 1) : path)

  const collections = new Set<string>()
  for (const path of paths.map(local)) if (endsInParameter(path)) collections.add(parentOf(path) as string)

  type Placed = { collection: string; kind: Kind; tail: string[]; detail: string | null }
  const placed = new Map<string, Placed>()
  for (const path of paths) {
    const here = local(path)
    if (endsInParameter(here)) {
      // Stryker disable next-line ArrayDeclaration: only an action's name is built from its tail
      placed.set(path, { collection: parentOf(here) as string, kind: 'detail', tail: [], detail: here })
      continue
    }
    if (collections.has(here)) {
      // Stryker disable next-line ArrayDeclaration: only an action's name is built from its tail
      placed.set(path, { collection: here, kind: 'collection', tail: [], detail: null })
      continue
    }
    let ancestor = parentOf(here)
    while (ancestor !== null && !collections.has(ancestor) && !endsInParameter(ancestor)) ancestor = parentOf(ancestor)
    if (ancestor === null) {
      collections.add(here)
      // Stryker disable next-line ArrayDeclaration: only an action's name is built from its tail
      placed.set(path, { collection: here, kind: 'collection', tail: [], detail: null })
      continue
    }
    const tail = segmentsOf(here.slice(ancestor.length))
    // A detail action names its collection even when the document has no path for the detail itself.
    if (endsInParameter(ancestor)) collections.add(parentOf(ancestor) as string)
    placed.set(
      path,
      endsInParameter(ancestor)
        ? { collection: parentOf(ancestor) as string, kind: 'detailAction', tail, detail: ancestor }
        : { collection: ancestor, kind: 'collectionAction', tail, detail: null }
    )
  }

  const warnings: string[] = []
  const resources = new Map<string, Resource>()
  for (const collection of [...collections].sort()) {
    const statics = segmentsOf(collection).filter((segment) => !PARAMETER.test(segment))
    let name = camel(statics.length === 0 ? ['root'] : statics)
    if ([...resources.values()].some((resource) => resource.name === name)) {
      let n = 2
      while ([...resources.values()].some((resource) => resource.name === `${name}${n}`)) n += 1
      warnings.push(`${collection}: "${name}" is taken by another resource, so it is "${name}${n}"`)
      name = `${name}${n}`
    }
    resources.set(collection, { name, collection, parents: parametersOf(collection), members: [] })
  }

  const hasDetail = (collection: string) =>
    [...placed.values()].some((place) => place.kind === 'detail' && place.collection === collection)
  // CRUD names first, then detail actions, then collection actions: a later one yields on a clash.
  const order: Kind[] = ['collection', 'detail', 'detailAction', 'collectionAction']
  for (const kind of order) {
    for (const path of paths) {
      const place = placed.get(path) as Placed
      if (place.kind !== kind) continue
      const resource = resources.get(place.collection) as Resource
      const found = operations.get(path) as Operation[]
      for (const operation of found) {
        const wanted = nameOf(place, operation, found.length, hasDetail(place.collection))
        const taken = (candidate: string) => resource.members.some((member) => member.name === candidate)
        let name = wanted
        if (taken(name)) {
          const fallbacks = [
            camel([operation.method, ...place.tail]),
            // Stryker disable next-line ConditionalExpression,StringLiteral: a detail action gets here only when earlier members hold both its name and its verb-prefixed one, which no route tried does
            camel([kind === 'collectionAction' ? 'collection' : 'detail', ...place.tail, operation.method]),
          ]
          name = fallbacks.find((candidate) => !taken(candidate)) ?? `${wanted}${resource.members.length}`
          warnings.push(
            `${operation.method.toUpperCase()} ${path}: "${wanted}" is taken in ${resource.name}, so it is "${name}"`
          )
        }
        const id = place.detail === null ? null : (parametersOf(place.detail).at(-1) as string)
        resource.members.push({ name, kind, operation, id })
      }
    }
  }
  return {
    resources: [...resources.values()].filter((resource) => resource.members.length > 0),
    prefixParameters: parametersOf(prefix),
    warnings,
  }
}

function nameOf(place: { kind: Kind; tail: string[] }, operation: Operation, methods: number, detail: boolean): string {
  const { method } = operation
  if (place.kind === 'collection') return (detail ? COLLECTION_NAMES[method] : undefined) ?? method
  if (place.kind === 'detail') return DETAIL_NAMES[method] ?? `${method}One`
  return methods === 1 ? camel(place.tail) : `${method}${pascal(place.tail)}`
}

/** `v0` is `/v0/`: a prefix starts and ends with a slash, so it ends on a segment boundary. */
function normalized(prefix: string | undefined): string | undefined {
  if (prefix === undefined) return undefined
  // An empty one is `//`, which no path starts with.
  return `/${prefix.replace(/^\/+|\/+$/g, '')}/`
}

/** The leading segments every path shares, leaving each at least one of its own. */
function commonPrefix(paths: string[]): string {
  // Stryker disable next-line StringLiteral: with no paths, nothing is ever matched against it
  if (paths.length === 0) return '//'
  const lists = paths.map(segmentsOf)
  const shortest = Math.min(...lists.map((list) => list.length))
  let length = 0
  while (length < shortest - 1 && lists.every((list) => list[length] === lists[0][length])) length += 1
  return `/${lists[0].slice(0, length).join('/')}/`
}
