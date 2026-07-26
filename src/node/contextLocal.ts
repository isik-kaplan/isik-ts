import { AsyncLocalStorage } from 'node:async_hooks'

const registry = new Map<string, AsyncLocalStorage<unknown>>()

export function contextLocal<T>(name: string): AsyncLocalStorage<T> {
  let storage = registry.get(name)
  if (!storage) {
    storage = new AsyncLocalStorage<T>()
    registry.set(name, storage)
  }
  return storage as AsyncLocalStorage<T>
}
