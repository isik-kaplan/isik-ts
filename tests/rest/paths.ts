// What openapi-typescript 7 emits for a small DRF API plus an allauth-style endpoint: absent methods
// as `?: never`, path-item parameters, numeric status keys, and `content?: never` for a 204.

type Task = { id: string; title: string; status: 'open' | 'done' }
type TaskRequest = { title: string; status?: 'open' | 'done' }
type Errors = Record<string, string[]>
type Json<T> = { headers: { [name: string]: unknown }; content: { 'application/json': T } }
type Empty = { headers: { [name: string]: unknown }; content?: never }
type NoParameters = { query?: never; header?: never; path?: never; cookie?: never }
type Absent = { put?: never; post?: never; delete?: never; options?: never; head?: never; patch?: never; trace?: never }

export interface paths {
  '/v0/tasks/': {
    parameters: NoParameters
    get: {
      parameters: {
        query?: { page?: number; status?: ('open' | 'done')[] }
        header?: never
        path?: never
        cookie?: never
      }
      requestBody?: never
      responses: { 200: Json<{ count: number; results: Task[] }> }
    }
    post: {
      parameters: { query?: never; header?: { 'Idempotency-Key'?: string }; path?: never; cookie?: never }
      requestBody: { content: { 'application/json': TaskRequest } }
      responses: { 201: Json<Task>; 400: Json<Errors> }
    }
  } & Omit<Absent, 'post'>
  '/v0/tasks/{id}/': {
    parameters: NoParameters
    get: {
      parameters: { query?: { expand?: string }; header?: never; path: { id: string }; cookie?: never }
      requestBody?: never
      responses: { 200: Json<Task>; 404: Json<{ detail: string }> }
    }
    put?: never
    post?: never
    delete: {
      parameters: {
        query?: never
        header: { 'If-Match': string; 'Idempotency-Key': string }
        path: { id: string }
        cookie?: never
      }
      requestBody?: never
      responses: { 204: Empty; 412: Json<{ detail: string; current: Task }> }
    }
    options?: never
    head?: never
    patch: {
      parameters: {
        query?: never
        header: { 'If-Match': string; 'Idempotency-Key'?: string }
        path: { id: string }
        cookie?: never
      }
      requestBody?: { content: { 'application/json': Partial<TaskRequest> } }
      responses: { 200: Json<Task>; 400: Json<Errors>; 412: Json<{ detail: string; current: Task }> }
    }
    trace?: never
  }
  '/v0/tasks/{id}/archive/': {
    parameters: NoParameters
    get?: never
    post: {
      parameters: { query?: never; header?: never; path: { id: string }; cookie?: never }
      requestBody?: never
      responses: { 200: Json<Task> }
    }
  } & Omit<Absent, 'post'>
  '/v0/tasks/stats/': {
    parameters: NoParameters
    get: {
      parameters: NoParameters
      requestBody?: never
      responses: { 200: Json<{ open: number }> }
    }
  } & Absent
  '/v0/projects/{project}/members/': {
    parameters: NoParameters
    get: {
      parameters: { query?: never; header?: never; path: { project: number }; cookie?: never }
      requestBody?: never
      responses: { 200: Json<{ user: number }[]> }
    }
  } & Absent
  '/v0/projects/{project}/members/{user}/': {
    parameters: NoParameters
    get?: never
    delete: {
      parameters: { query?: never; header?: never; path: { project: number; user: number }; cookie?: never }
      requestBody?: never
      responses: { 204: Empty }
    }
  } & Omit<Absent, 'delete'>
  '/v0/things': {
    parameters: NoParameters
    get?: never
  } & Absent
  '/v0/things/{slug}': {
    parameters: NoParameters
    get: {
      parameters: { query?: never; header: { 'X-Tenant': string }; path: { slug: string }; cookie?: never }
      requestBody?: never
      responses: { 200: Json<{ slug: string }>; default: Json<{ message: string }> }
    }
  } & Absent
  '/v0/things/{slug}/thumbnail': {
    parameters: NoParameters
    get?: never
    put: {
      parameters: { query?: never; header?: never; path: { slug: string }; cookie?: never }
      requestBody: { content: { 'multipart/form-data': FormData } }
      responses: { 204: Empty }
    }
  } & Omit<Absent, 'put'>
  '/v0/account/email': {
    parameters: NoParameters
    get: { parameters: NoParameters; requestBody?: never; responses: { 200: Json<{ email: string }[]> } }
    post: {
      parameters: NoParameters
      requestBody: { content: { 'application/json': { email: string } } }
      responses: { 200: Json<{ email: string }[]>; 400: Json<{ errors: { code: string }[] }> }
    }
  } & Omit<Absent, 'post'>
  '/v0/health': {
    parameters: NoParameters
    get: { parameters: NoParameters; requestBody?: never; responses: { 200: { headers: { [name: string]: unknown } } } }
  } & Absent
}
