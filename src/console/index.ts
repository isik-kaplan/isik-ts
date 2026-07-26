type ConsoleMethod = (...args: unknown[]) => void
type WindowLike = Window & typeof globalThis

const patchedWindows = new WeakMap<WindowLike, Set<string>>()

export function createConsoleDebugSwitch(targetWindow: WindowLike, options: { namespace: string }): void {
  if (!targetWindow) {
    return
  }

  const { namespace } = options

  let enabledNamespaces = patchedWindows.get(targetWindow)
  if (!enabledNamespaces) {
    enabledNamespaces = new Set<string>()
    patchedWindows.set(targetWindow, enabledNamespaces)

    const original = {
      log: targetWindow.console.log.bind(targetWindow.console),
      info: targetWindow.console.info.bind(targetWindow.console),
      warn: targetWindow.console.warn.bind(targetWindow.console),
      error: targetWindow.console.error.bind(targetWindow.console),
    }

    const conditional =
      (method: ConsoleMethod): ConsoleMethod =>
      (...args) => {
        if (enabledNamespaces!.size > 0) {
          method(...args)
        }
      }

    targetWindow.console.log = conditional(original.log)
    targetWindow.console.info = conditional(original.info)
    targetWindow.console.warn = conditional(original.warn)
    targetWindow.console.error = conditional(original.error)
  }

  type Namespace = { debug: (enabled: boolean) => void }
  const globals = targetWindow as unknown as Record<string, Namespace | undefined>
  const existing = Object.prototype.hasOwnProperty.call(globals, namespace)
    ? (Object.getOwnPropertyDescriptor(globals, namespace)?.value as Namespace | undefined)
    : undefined
  const target = existing ?? ({} as Namespace)
  target.debug = (flag: boolean) => {
    if (flag) {
      enabledNamespaces!.add(namespace)
    } else {
      enabledNamespaces!.delete(namespace)
    }
  }
  // Object.defineProperty (unlike a plain `globals[namespace] = target` assignment) always
  // creates/overwrites an own property, even when namespace is a name like "__proto__" that
  // would otherwise be intercepted by Object.prototype's special __proto__ accessor and
  // pollute the shared prototype instead of setting a property on this specific object.
  Object.defineProperty(globals, namespace, { value: target, writable: true, configurable: true, enumerable: true })
}
