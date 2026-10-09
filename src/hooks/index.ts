import type { ChangeEvent, DependencyList, DragEvent, EffectCallback } from 'react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { type FormErrors, detailOf, messagesOf, toFormErrors } from '../drf'
import { browserSupportsPasskeys } from '../webauthn'

export function useElementAttributes<T extends HTMLElement, K extends keyof T>(attributeKeys: K[]) {
  const ref = useRef<T | null>(null)
  const [attributeValues, setAttributeValue] = useState<Partial<Pick<T, K>>>({})

  const updateAttribute = useCallback(() => {
    if (ref.current) {
      const values = {} as Partial<Pick<T, K>>
      for (const key of attributeKeys) {
        // Object.defineProperty (unlike a plain `values[key] = value` assignment) always creates/
        // overwrites an own property, even if a consumer's T somehow has a key like "__proto__" -
        // matches the same defensive pattern used everywhere else in this package that writes a
        // non-literal key onto an object.
        Object.defineProperty(values, key, {
          value: ref.current[key],
          writable: true,
          configurable: true,
          enumerable: true,
        })
      }

      setAttributeValue((prevValues) => {
        const hasChanged = attributeKeys.some((key) => prevValues[key] !== values[key])
        return hasChanged ? values : prevValues
      })
    }
  }, [attributeKeys])

  useEffect(() => {
    updateAttribute()
    window.addEventListener('resize', updateAttribute)

    if (ref.current) {
      const observer = new MutationObserver(updateAttribute)
      observer.observe(ref.current, { attributes: true })

      return () => {
        window.removeEventListener('resize', updateAttribute)
        observer.disconnect()
      }
    }

    return () => {
      window.removeEventListener('resize', updateAttribute)
    }
  }, [updateAttribute])

  return { ref, attributeValues }
}

type InputEventType = ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>

export function useFormState<T>(initialState: T) {
  const [formState, setFormState] = useState<T>(initialState)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string[]>> & { non_field_errors?: string[] }>()

  function resetFormState() {
    setFormState(initialState)
  }

  function handleFormState<K extends keyof T, HandlerInputType>({
    key,
    inputType,
  }: {
    key: K
    inputType: 'event' | 'value'
  }) {
    return (event: HandlerInputType) => {
      let value: T[K]
      if (inputType === 'event') {
        const target = (event as InputEventType).target
        if (target.type === 'checkbox') {
          value = (target as HTMLInputElement).checked as T[K]
        } else if (target.type === 'number' || target.type === 'range') {
          value = (target as HTMLInputElement).valueAsNumber as T[K]
        } else {
          value = target.value as T[K]
        }
      } else {
        value = event as T[K]
      }
      setFormState((prev) => ({ ...prev, [key]: value }))
    }
  }

  // Stryker disable next-line StringLiteral: equivalent mutant. handleFormState only ever
  // compares inputType against 'event' - any other string, including this one, takes the exact
  // same branch, so the specific label 'value' carries no behavior of its own.
  const handleFormStateValue = <K extends keyof T>(key: K) => handleFormState<K, T[K]>({ key, inputType: 'value' })
  const handleFormStateEvent = <K extends keyof T>(key: K) =>
    handleFormState<K, InputEventType>({ key, inputType: 'event' })
  const handleFormStateOnClick =
    <K extends keyof T>(key: K, value: T[K]) =>
    () => {
      setFormState((prev) => ({ ...prev, [key]: value }))
    }

  return {
    formState,
    setFormState,
    formErrors,
    setFormErrors,
    handleFormStateValue,
    handleFormStateEvent,
    handleFormStateOnClick,
    resetFormState,
  }
}

export function useEffectAfterMount(effect: EffectCallback, deps: DependencyList) {
  const isFirstRender = useRef(true)

  // StrictMode mounts, unmounts and mounts again in development, and the ref survives in between, so
  // the second mount would read as an update. Resetting on unmount - its own effect, so a deps change
  // does not reset it - makes every mount a first one.
  useEffect(
    () => () => {
      isFirstRender.current = true
    },
    // Stryker disable next-line ArrayDeclaration: equivalent mutant. Any constant list compares equal
    // to itself every render, so the cleanup still runs only on unmount.
    []
  )

  // No manual "did deps actually change" recheck needed here: React's own useEffect already
  // only re-invokes this callback when a dependency's value changed (shallow-compared against
  // the last time *this exact effect* ran) - which is exactly the same comparison a hand-rolled
  // check against a "previous deps" ref would be making, just duplicated.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    return effect()
  }, deps)
}

/**
 * Whether the calling component is still mounted, read at the moment of asking - for an effect whose
 * work outlives the component, such as a fetch that resolves after the screen was left.
 *
 * A function rather than a boolean, because a boolean would be the value from the render that
 * started the work, not the one that finishes it. It reads false during the first render, before
 * React has committed anything.
 *
 * No DOM in it, so it works the same in React Native.
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false)

  // Both dependency lists are equivalent mutants: a fixed literal compares equal to itself every
  // render, so any constant list reruns the effect and keeps the callback exactly as the empty one.
  // Stryker disable ArrayDeclaration
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return useCallback(() => mounted.current, [])
}
// Stryker restore ArrayDeclaration

/**
 * Whether a MIME type is one an `accept`-style list allows: `image/*` matches any `image/` type, and
 * every other entry matches exactly. An empty list allows nothing; callers treat it as no filter.
 */
function matchesAcceptedType(type: string, accepted: string[]): boolean {
  return accepted.some((entry) => (entry.endsWith('/*') ? type.startsWith(entry.slice(0, -1)) : type === entry))
}

export function useFilePaste({
  acceptedTypes,
  maxSize,
  targetElement,
  enabled = true,
}: {
  acceptedTypes?: string[]
  maxSize?: number
  targetElement?: HTMLElement | null
  enabled?: boolean
} = {}): {
  files: File[]
  error: string | null
  clearFiles: () => void
} {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)

  // The callback body below closes over nothing but the stable setFiles/setError setters, so
  // its dependency array's contents can never affect whether useCallback returns the same
  // function - a literal added there would compare equal (Object.is) to itself every render.
  const clearFiles = useCallback(
    () => {
      setFiles([])
      setError(null)
    }, // Stryker disable next-line ArrayDeclaration: equivalent mutant, see above.
    []
  )

  const validateFiles = useCallback(
    (pastedFiles: File[]): { valid: true } | { valid: false; error: string } => {
      if (acceptedTypes && acceptedTypes.length > 0) {
        const invalidFiles = pastedFiles.filter((file) => !matchesAcceptedType(file.type, acceptedTypes))
        if (invalidFiles.length > 0) {
          const invalidFileNames = invalidFiles.map((file) => file.name).join(', ')
          return {
            valid: false,
            error: `Invalid file types: ${invalidFileNames}. Accepted types: ${acceptedTypes.join(', ')}`,
          }
        }
      }

      if (maxSize) {
        const oversizedFile = pastedFiles.find((file) => file.size > maxSize)
        if (oversizedFile) {
          const fileSizeMB = (oversizedFile.size / (1024 * 1024)).toFixed(2)
          const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2)
          return {
            valid: false,
            error: `File "${oversizedFile.name}" (${fileSizeMB} MB) exceeds the maximum size of ${maxSizeMB} MB`,
          }
        }
      }

      return { valid: true }
    },
    [acceptedTypes, maxSize]
  )

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const { clipboardData } = event
      if (!clipboardData) return

      const hasFiles = clipboardData.files && clipboardData.files.length > 0
      if (!hasFiles) return

      event.preventDefault()

      const pastedFiles = Array.from(clipboardData.files)
      const validation = validateFiles(pastedFiles)

      if (!validation.valid) {
        setError(validation.error)
        setFiles([])
      } else {
        setError(null)
        setFiles(pastedFiles)
      }
    },
    [validateFiles]
  )

  useEffect(() => {
    if (!enabled) return

    const target = targetElement || document

    target.addEventListener('paste', handlePaste as EventListener)
    return () => {
      target.removeEventListener('paste', handlePaste as EventListener)
    }
  }, [enabled, handlePaste, targetElement])

  return { files, error, clearFiles }
}

type FileDragDropState = {
  isDragging: boolean
  files: File[] | null
}

type FileDragDropOptions = {
  onDrop?: (files: File[]) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragLeave?: (e: DragEvent<HTMLElement>) => void
  acceptedFileTypes?: string[]
  maxFileSize?: number
  multiple?: boolean
}

export function useFileDragDrop<T extends HTMLElement = HTMLDivElement>(options: FileDragDropOptions = {}) {
  const { onDrop, onDragOver, onDragLeave, acceptedFileTypes, maxFileSize, multiple = true } = options

  const [state, setState] = useState<FileDragDropState>({
    isDragging: false,
    files: null,
  })

  const ref = useRef<T | null>(null)
  const dragCounter = useRef(0)

  const handleDragOver = useCallback(
    (e: DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()

      onDragOver?.(e)
    },
    [onDragOver]
  )

  const handleDragEnter = useCallback(
    (e: DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()

      dragCounter.current += 1

      // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent mutant on
      // the `.length > 0` half specifically. When items is truthy but empty, entering the block
      // anyway still runs Array.from([]).some(...), which is vacuously false - the same no-op as
      // skipping it - so relaxing this to `>= 0` (or dropping it) can't change the outcome.
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const hasValidItems = Array.from(e.dataTransfer.items).some((item) => {
          if (item.kind !== 'file') {
            return false
          }

          if (acceptedFileTypes && acceptedFileTypes.length > 0) {
            return matchesAcceptedType(item.type, acceptedFileTypes)
          }

          return true
        })

        if (hasValidItems) {
          setState((prevState) => ({
            ...prevState,
            isDragging: true,
          }))
        }
      }
    },
    [acceptedFileTypes]
  )

  const handleDragLeave = useCallback(
    (e: DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()

      dragCounter.current -= 1

      if (dragCounter.current === 0) {
        setState((prevState) => ({
          ...prevState,
          isDragging: false,
        }))
      }

      onDragLeave?.(e)
    },
    [onDragLeave]
  )

  const handleDrop = useCallback(
    (e: DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()

      dragCounter.current = 0
      setState((prevState) => ({
        ...prevState,
        isDragging: false,
      }))

      // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent mutant on
      // the `.length > 0` half specifically. When files is truthy but empty, entering the block
      // anyway still runs Array.from([]) and every downstream filter/length check on it, which
      // stay vacuously empty - the same no-op as skipping it - so relaxing this to `>= 0` (or
      // dropping it) can't change the outcome.
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        let validFiles = Array.from(e.dataTransfer.files)

        if (acceptedFileTypes && acceptedFileTypes.length > 0) {
          validFiles = validFiles.filter((file) => matchesAcceptedType(file.type, acceptedFileTypes))
        }

        if (maxFileSize) {
          validFiles = validFiles.filter((file) => file.size <= maxFileSize)
        }

        if (!multiple && validFiles.length > 0) {
          validFiles = [validFiles[0]]
        }

        if (validFiles.length > 0) {
          setState((prevState) => ({
            ...prevState,
            files: validFiles,
          }))

          onDrop?.(validFiles)
        }
      }
    },
    [onDrop, acceptedFileTypes, maxFileSize, multiple]
  )

  useEffect(() => {
    const currentRef = ref.current
    if (currentRef) {
      currentRef.addEventListener('dragover', handleDragOver as unknown as EventListener)
      currentRef.addEventListener('dragenter', handleDragEnter as unknown as EventListener)
      currentRef.addEventListener('dragleave', handleDragLeave as unknown as EventListener)
      currentRef.addEventListener('drop', handleDrop as unknown as EventListener)

      return () => {
        currentRef.removeEventListener('dragover', handleDragOver as unknown as EventListener)
        currentRef.removeEventListener('dragenter', handleDragEnter as unknown as EventListener)
        currentRef.removeEventListener('dragleave', handleDragLeave as unknown as EventListener)
        currentRef.removeEventListener('drop', handleDrop as unknown as EventListener)
      }
    }
    return undefined
  }, [handleDragOver, handleDragEnter, handleDragLeave, handleDrop])

  // The callback body below closes over nothing but the stable setState setter, so its
  // dependency array's contents can never affect whether useCallback returns the same function -
  // a literal added there would compare equal (Object.is) to itself every render.
  const reset = useCallback(
    () => {
      setState({
        isDragging: false,
        files: null,
      })
    }, // Stryker disable next-line ArrayDeclaration: equivalent mutant, see above.
    []
  )

  return {
    ref,
    isDragging: state.isDragging,
    files: state.files,
    reset,
  }
}

export type IdempotencyKeyOptions = {
  // Default: a v4 UUID - `crypto.randomUUID()` where there is one, built from
  // `crypto.getRandomValues()` where there is not, as on a page served over plain http. Bare Hermes
  // has neither; pass any generator of unique strings there - a polyfilled uuid, say.
  generateKey?: () => string
}

/**
 * `randomUUID` exists only in a secure context, so a dev stack on plain http behind a hostname has
 * none. `getRandomValues` exists everywhere `crypto` does, and 16 of its bytes are a v4 UUID once the
 * version and variant bits are set.
 */
function randomUUID(): string {
  const crypto = globalThis.crypto as Partial<Crypto> | undefined
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new TypeError(
      'useIdempotencyKey: this runtime has neither crypto.randomUUID nor crypto.getRandomValues - pass ' +
        '`generateKey`, or install a polyfill such as react-native-get-random-values'
    )
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

/**
 * An `Idempotency-Key` that belongs to the attempt, not the call.
 *
 * A key minted per call protects nothing: a person who presses submit again after a lost response
 * makes a second call, and a second key, and the server does the work twice. So `keyFor(payload)`
 * answers the same key for as long as the payload is the same, and a new one the moment it changes.
 * `used()` ends the attempt once the server has accepted it, so the next one starts clean.
 *
 * Because the key changes exactly when the payload does, this never sends the server one key with
 * two payloads - a "same key, different payload" refusal then only ever means some other caller.
 *
 * The payload is compared by `JSON.stringify`, so:
 * - a reordered object reads as a new payload and gets a new key. That is harmless - a new attempt
 *   is always a safe answer.
 * - a `File` reads as `{}`, so two different uploads would share a key. A multipart form wants its
 *   own snapshot, such as the file names and sizes, passed as the payload instead.
 * - a `BigInt` or a cycle throws, as `JSON.stringify` does.
 *
 * Placing the header is the caller's, since every client places it differently.
 */
export function useIdempotencyKey({ generateKey = randomUUID }: IdempotencyKeyOptions = {}) {
  const attempt = useRef<{ snapshot: string | undefined; key: string } | null>(null)

  // `payload` is optional for a write with no body, which still wants one key per attempt.
  function keyFor(payload?: unknown): string {
    const snapshot = JSON.stringify(payload)
    if (attempt.current === null || attempt.current.snapshot !== snapshot) {
      attempt.current = { snapshot, key: generateKey() }
    }
    return attempt.current.key
  }

  function used() {
    attempt.current = null
  }

  return { keyFor, used }
}

/**
 * `useIdempotencyKey` read during render, for a caller that wants the key as a value - to show it, or
 * to hand it to something that takes props.
 *
 * Prefer `useIdempotencyKey` where the payload is at hand when sending: this one keys the values as
 * rendered, which are not always what is sent - a schema's `.trim()` turns two values into one
 * payload, and this gives them two keys. `used()` re-renders, so `key` is fresh after it.
 */
export function useIdempotencyKeyOf(values: unknown, options?: IdempotencyKeyOptions) {
  const { keyFor, used } = useIdempotencyKey(options)
  const [, rerender] = useState({})

  return {
    key: keyFor(values),
    used: () => {
      used()
      rerender({})
    },
  }
}

/**
 * Where a submit puts what it has to say to a person. sonner's `toast` already has this shape and can
 * be passed as it is; a library cannot pick the toast for the app.
 */
export type Reporter = {
  success: (message: string) => unknown
  error: (message: string) => unknown
}

/**
 * How a server's refusal is read: its field errors, and the one sentence it wrote for a person.
 * `@isikk/core/drf`'s readers are the default; `allauthEnvelope` from `@isikk/core/allauth` reads
 * django-allauth's headless API, and anything with these two functions reads another server.
 */
export type ErrorEnvelope = {
  toFormErrors: (body: unknown) => FormErrors | undefined
  detailOf: (body: unknown) => string | undefined
}

const drfEnvelope: ErrorEnvelope = { toFormErrors, detailOf }

/** What a typed client returns - openapi-fetch's result, with the status and not only the body. */
export type APIResult = { data?: unknown; error?: unknown; response?: Response }

export type APISubmitOptions<R extends APIResult> = {
  // Default: no error, and a response that is `ok` if there is one. Override for an endpoint whose
  // success arrives as a non-2xx - allauth answers an already-logged-in visitor with a 409.
  isSuccess?: (result: R) => boolean
  // Silence on success is the default - a form that visibly saved does not need telling. Pass one
  // only where the change happens somewhere the person is not looking.
  success?: string
  failure: string
  // Where a 400's field errors go. Given one, they render beside the inputs that caused them and
  // nothing is reported; without one they are reported as one line, which is what a button with no
  // form behind it wants. Only ever called with errors there are.
  setFormErrors?: (errors: FormErrors) => void
  onSuccess?: (result: R, outcome: SubmitOutcome) => void
  // The screen leaves on success - `onSuccess` navigates. Keeps `isSubmitting` set and refuses
  // another submit from then on, because an app-router navigation is a fetch, not a frame, and the
  // old screen stays mounted and clickable while it runs. The price: a navigation that is cancelled
  // or fails leaves the form disabled until a reload. For a write that is the right way round - a
  // dead button is recoverable, a second charge is not.
  leavesOnSuccess?: boolean
}

export type SubmitOutcome = {
  // The server answered from an earlier attempt with the same `Idempotency-Key` rather than doing the
  // work again - worth telling a person "already done" rather than "saved".
  replayed: boolean
}

function succeeded(result: APIResult): boolean {
  return !result.error && (result.response === undefined || result.response.ok)
}

function outcomeOf(result: APIResult): SubmitOutcome {
  return { replayed: result.response?.headers.get('Idempotent-Replayed') === 'true' }
}

/**
 * The tail every write shares: a submitting flag, the call, and the server's refusal put where a
 * person can read it.
 *
 * Refusals are read as Django REST framework writes them - see `@isikk/core/drf` - unless another
 * `envelope` is given. Anything the envelope cannot read falls back to `failure`, so another server's
 * errors read as a plain failure, not as none.
 *
 * Refreshing or navigating after success stays at the call site, through `onSuccess`. Reaching for a
 * router here would make every caller a router consumer, including the ones that render their own
 * result. A caller that navigates says so with `leavesOnSuccess`.
 *
 * A submit made while another is in flight is refused - it resolves to `false` without making the
 * call. `isSubmitting` disables a button only once React commits, so two clicks in one frame would
 * otherwise both get through.
 */
export function useAPISubmit(reporter: Reporter, envelope: ErrorEnvelope = drfEnvelope) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  // State answers too late to guard with: it changes on the next commit, not on this call.
  const locked = useRef(false)

  function release() {
    locked.current = false
    setIsSubmitting(false)
  }

  async function submit<R extends APIResult>(call: () => Promise<R>, options: APISubmitOptions<R>): Promise<boolean> {
    if (locked.current) return false
    locked.current = true
    setIsSubmitting(true)
    let result: R
    try {
      result = await call()
    } catch (error) {
      // A call that throws is the caller's to handle, but it must not leave the form locked.
      release()
      throw error
    }

    const isSuccess = (options.isSuccess ?? succeeded)(result)
    if (!(isSuccess && options.leavesOnSuccess)) release()

    if (isSuccess) {
      if (options.success) reporter.success(options.success)
      options.onSuccess?.(result, outcomeOf(result))
      return true
    }

    const status = result.response?.status
    const fields = status === 400 ? envelope.toFormErrors(result.error) : undefined
    if (fields && options.setFormErrors) {
      options.setFormErrors(fields)
      return false
    }

    // A 5xx says nothing worth reading and often is not JSON at all, so only a refusal the server
    // wrote for a person is shown in its own words. Never reaching the server at all reads the same
    // way.
    const detail = status === undefined || status >= 500 ? undefined : envelope.detailOf(result.error)
    reporter.error(detail ?? messagesOf(fields) ?? options.failure)
    return false
  }

  return { isSubmitting, submit }
}

type StandardIssue = {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

type StandardResult<Output> =
  { readonly value: Output; readonly issues?: undefined } | { readonly issues: ReadonlyArray<StandardIssue> }

/**
 * The part of the Standard Schema interface (https://standardschema.dev) this library reads. zod,
 * valibot and ArkType all implement it, so none of them is a dependency here.
 */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}

export type ValidatedFormStateOptions = IdempotencyKeyOptions & {
  // How the server's refusals are read - see `useAPISubmit`.
  envelope?: ErrorEnvelope
}

type ValidatedSubmitOptions<R extends APIResult> = Omit<APISubmitOptions<R>, 'setFormErrors'>

type InputOf<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['input']
type OutputOf<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['output']

// An issue is filed under the field its path starts at, as zod's own `flatten` does, and one with no
// path is about the form as a whole. Built through entries so a field named `__proto__` is a field.
function fromIssues(issues: ReadonlyArray<StandardIssue>): FormErrors {
  const errors = new Map<string, string[]>()
  for (const { message, path } of issues) {
    const [segment] = path ?? []
    const field =
      segment === undefined ? 'non_field_errors' : String(typeof segment === 'object' ? segment.key : segment)
    errors.set(field, [...(errors.get(field) ?? []), message])
  }
  return Object.fromEntries(errors)
}

/**
 * Form state, validation, and the submit tail, as one object.
 *
 * The submit half is `useAPISubmit`, composed rather than reimplemented, because half the writes in
 * a real app are a button or a switch with no form behind them, and those use it directly. Composing
 * is what puts the server's 400 field errors into the same `formErrors` the schema writes to, so a
 * refusal from either side renders in the same place.
 *
 * `validate` needs a synchronous schema, which every zod and valibot schema without an async
 * refinement is. `submit` is async regardless, so it accepts either.
 *
 * Every submit carries an idempotency key from `useIdempotencyKey`, keyed on the schema's output, so a
 * resubmit after a lost response is recognized as the same attempt. A write that sends none passes
 * `idempotencyKey: false`, and no key is minted at all - nothing here touches the network.
 */
export function useValidatedFormState<S extends StandardSchemaV1<object>>(
  schema: S,
  initialState: InputOf<S>,
  reporter: Reporter,
  options?: ValidatedFormStateOptions
) {
  const form = useFormState<InputOf<S>>(initialState)
  const { isSubmitting, submit: submitToAPI } = useAPISubmit(reporter, options?.envelope)
  const { keyFor, used } = useIdempotencyKey(options)
  // Typed against this call's concrete S, which a generic S cannot be checked against here - the
  // shape, a list of messages per field plus non_field_errors, is the same.
  const setFormErrors = form.setFormErrors as (errors: FormErrors | undefined) => void

  function record(result: StandardResult<OutputOf<S>>): StandardResult<OutputOf<S>> {
    setFormErrors(result.issues ? fromIssues(result.issues) : undefined)
    return result
  }

  /**
   * Synchronous on purpose. An async one would return a Promise, which is always truthy, so a caller
   * writing `if (!validate()) return` would let every form through - and TypeScript does not flag
   * the negated form. A schema that answers asynchronously is refused loudly rather than guessed at.
   */
  function validate(): boolean {
    const result = schema['~standard'].validate(form.formState)
    // A thenable rather than `instanceof Promise`, which misses one made in another realm.
    if (typeof (result as Partial<PromiseLike<unknown>>).then === 'function') {
      throw new TypeError('useValidatedFormState: validate() needs a synchronous schema - submit() awaits an async one')
    }
    return !record(result as StandardResult<OutputOf<S>>).issues
  }

  /**
   * A server error naming a field this form does not hold has nowhere to render, and dropping it
   * loses the only thing the server said. Those join `non_field_errors`, which every form shows.
   */
  function acceptServerErrors(errors: FormErrors) {
    const { non_field_errors: nonField = [], ...fields } = errors
    const routed: Array<[string, string[]]> = []
    const orphaned: string[] = []
    for (const [field, messages] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(form.formState, field)) routed.push([field, messages])
      else orphaned.push(...messages)
    }
    const formWide = [...nonField, ...orphaned]
    if (formWide.length > 0) routed.push(['non_field_errors', formWide])
    setFormErrors(Object.fromEntries(routed))
  }

  /**
   * Validates first, so a form never spends a round trip on something it could refuse itself, and
   * hands the call the schema's output rather than the raw state, so a transform is not lost.
   *
   * The key is spent before `onSuccess` runs, so a submit made from there is a new attempt. A refusal
   * or a throw keeps it: the same payload sent again is the same attempt.
   *
   * `idempotencyKey: false` hands the call the value alone. An explicit option rather than reading the
   * call's arity, which a default parameter or a rest parameter would misreport.
   */
  async function submit<R extends APIResult>(
    call: (value: OutputOf<S>, idempotencyKey: string) => Promise<R>,
    options: ValidatedSubmitOptions<R> & { idempotencyKey?: true }
  ): Promise<boolean>
  async function submit<R extends APIResult>(
    call: (value: OutputOf<S>) => Promise<R>,
    options: ValidatedSubmitOptions<R> & { idempotencyKey: false }
  ): Promise<boolean>
  async function submit<R extends APIResult>(
    call: (value: OutputOf<S>, idempotencyKey: string) => Promise<R>,
    options: ValidatedSubmitOptions<R> & { idempotencyKey?: boolean }
  ): Promise<boolean> {
    const result = record(await schema['~standard'].validate(form.formState))
    if (result.issues) return false
    // Only the second overload leaves the key undefined, and its call never reads one.
    const key = options.idempotencyKey === false ? undefined : keyFor(result.value)
    return submitToAPI(() => call(result.value, key as string), {
      ...options,
      setFormErrors: acceptServerErrors,
      onSuccess: (response, outcome) => {
        used()
        options.onSuccess?.(response, outcome)
      },
    })
  }

  return { ...form, validate, isSubmitting, submit }
}

/**
 * `useAPISubmit` and `useValidatedFormState` with the reporter already supplied, so an app names its
 * toast once rather than once per hook:
 *
 *     export const { useAPISubmit, useValidatedFormState } = createSubmitHooks(toast)
 *
 * A factory rather than a provider or a module-level default: a provider is a component, and a
 * default is a global that leaks between tests and turns a forgotten reporter from a type error into
 * silence at runtime. The hooks it returns take no reporter, so there is nothing to forget.
 *
 * `envelope` is bound the same way - an allauth surface passes `allauthEnvelope` here once.
 */
export function createSubmitHooks(reporter: Reporter, envelope?: ErrorEnvelope) {
  return {
    useAPISubmit: () => useAPISubmit(reporter, envelope),
    useValidatedFormState: <S extends StandardSchemaV1<object>>(
      schema: S,
      initialState: InputOf<S>,
      options?: IdempotencyKeyOptions
    ) => useValidatedFormState(schema, initialState, reporter, { ...options, envelope }),
  }
}

// Support never changes while the page is open, so there is nothing to subscribe to.
// Stryker disable next-line ArrowFunction: equivalent mutant - React treats an undefined cleanup as none.
const subscribeToNothing = () => () => {}
const assumeSupported = () => true

/**
 * `browserSupportsPasskeys` for render. The server cannot answer it, so it renders the optimistic
 * answer and hydration replaces it with the browser's, with no mismatch warning - a passkey button
 * that disappears on an old browser, rather than one that appears late on every new one.
 */
export function useBrowserSupportsPasskeys(): boolean {
  return useSyncExternalStore(subscribeToNothing, browserSupportsPasskeys, assumeSupported)
}
