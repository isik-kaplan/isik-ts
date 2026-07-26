# console

## createConsoleDebugSwitch

Silences `window.console.{log,info,warn,error}` by default, and exposes a `window[namespace].debug(flag)` toggle to turn them back on at runtime (e.g. from the browser devtools console) - useful for keeping noisy debug logging out of a production build's console while still being able to switch it on for support/debugging without a redeploy.

```typescript
import { createConsoleDebugSwitch } from '@isikk/core'

if (typeof window !== 'undefined') {
  createConsoleDebugSwitch(window, { namespace: 'myApp' })
}

console.log('hello') // nothing printed - silenced by default

myApp.debug(true)
console.log('hello') // now prints
```

- The function itself no-ops if called with an explicit falsy value (e.g. `createConsoleDebugSwitch(undefined, ...)`), but it can't protect you from a bare, unguarded `window` reference - in Node, evaluating `window` as an argument throws `ReferenceError` before the call ever happens. Guard at the call site with `typeof window !== 'undefined'` as shown above, don't rely on the function's own check for that.
- The namespace is caller-supplied - nothing is hardcoded, so multiple libraries/apps on the same page can each expose their own named toggle (`window.app1.debug`, `window.app2.debug`, ...) instead of colliding on one global. The underlying `console` methods are only ever patched once per `window`, no matter how many namespaces register. If `namespace` isn't a hardcoded literal (e.g. it comes from a config file or user input), it's still safe to pass values like `'__proto__'` - the implementation uses `Object.defineProperty` rather than a plain assignment, so it can't be tricked into reassigning `window`'s prototype instead of setting a property on it.
- Because there's only one real `console` to patch, output isn't partitioned per namespace - it's a shared on/off light with multiple switches. Console output is visible whenever **at least one** registered namespace has called `debug(true)`, and goes silent again only once every namespace has been disabled (or none has ever been enabled).
