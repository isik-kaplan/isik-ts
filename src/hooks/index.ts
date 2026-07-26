import type { ChangeEvent, DependencyList, DragEvent, EffectCallback } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  isLoading: boolean
  error: string | null
  clearFiles: () => void
} {
  const [files, setFiles] = useState<File[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearFiles = useCallback(() => {
    setFiles([])
    setError(null)
  }, [])

  const validateFiles = useCallback(
    (pastedFiles: File[]): { valid: true } | { valid: false; error: string } => {
      if (acceptedTypes && acceptedTypes.length > 0) {
        const wildcardAcceptedTypes = acceptedTypes
          .filter((type) => type.endsWith('/*'))
          .map((type) => type.slice(0, -1))
        const normalizedAcceptedTypes = acceptedTypes.map((type) => (type.endsWith('/*') ? type.slice(0, -2) : type))

        const invalidFiles = pastedFiles.filter((file) => {
          const fileType = file.type
          return (
            !normalizedAcceptedTypes.includes(fileType) &&
            !wildcardAcceptedTypes.some((wildcardType) => fileType.startsWith(wildcardType))
          )
        })
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
      setIsLoading(true)
      setError(null)

      try {
        const pastedFiles = Array.from(clipboardData.files)
        const validation = validateFiles(pastedFiles)

        if (!validation.valid) {
          setError(validation.error)
          setFiles([])
        } else {
          setFiles(pastedFiles)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process pasted files')
        setFiles([])
      } finally {
        setIsLoading(false)
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

  return { files, isLoading, error, clearFiles }
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

      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const hasValidItems = Array.from(e.dataTransfer.items).some((item) => {
          if (item.kind !== 'file') {
            return false
          }

          if (acceptedFileTypes && acceptedFileTypes.length > 0) {
            return acceptedFileTypes.some((type) => {
              if (type.endsWith('/*')) {
                const category = type.split('/')[0]
                return item.type.startsWith(`${category}/`)
              }
              return item.type === type
            })
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

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        let validFiles = Array.from(e.dataTransfer.files)

        if (acceptedFileTypes && acceptedFileTypes.length > 0) {
          validFiles = validFiles.filter((file) =>
            acceptedFileTypes.some((type) => {
              if (type.endsWith('/*')) {
                const category = type.split('/')[0]
                return file.type.startsWith(`${category}/`)
              }
              return file.type === type
            })
          )
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

  const reset = useCallback(() => {
    setState({
      isDragging: false,
      files: null,
    })
  }, [])

  return {
    ref,
    isDragging: state.isDragging,
    files: state.files,
    reset,
  }
}
