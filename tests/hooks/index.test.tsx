import { act, render, renderHook } from '@testing-library/react'

import type { ChangeEvent } from 'react'
import { useEffect } from 'react'

import { describe, expect, it, vi } from 'vitest'

import { useEffectAfterMount, useElementAttributes, useFileDragDrop, useFilePaste, useFormState } from '../../src/hooks'

describe('useElementAttributes', () => {
  function TestComponent({
    attributeKeys,
    onCommit,
  }: {
    attributeKeys: Array<keyof HTMLInputElement>
    onCommit?: () => void
  }) {
    const { ref, attributeValues } = useElementAttributes<HTMLInputElement, keyof HTMLInputElement>(attributeKeys)
    // No deps: runs after every commit, and only after a commit. Counting render calls instead would
    // be wrong - React may call the component once more before bailing out of an unchanged state.
    useEffect(() => {
      onCommit?.()
    })
    return (
      <div>
        <input ref={ref} disabled value="" readOnly />
        <span data-testid="value">{String(attributeValues.disabled)}</span>
      </div>
    )
  }

  function UnattachedComponent({ attributeKeys }: { attributeKeys: Array<keyof HTMLDivElement> }) {
    useElementAttributes<HTMLDivElement, keyof HTMLDivElement>(attributeKeys)
    return null
  }

  it('reads the requested attribute values off the ref element', () => {
    const { getByTestId } = render(<TestComponent attributeKeys={['disabled']} />)
    expect(getByTestId('value').textContent).toBe('true')
  })

  it('does not re-render when a resize fires but the attribute value has not changed', () => {
    const onCommit = vi.fn()
    const { getByTestId } = render(<TestComponent attributeKeys={['disabled']} onCommit={onCommit} />)
    expect(getByTestId('value').textContent).toBe('true')
    const commitsAfterMount = onCommit.mock.calls.length

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(getByTestId('value').textContent).toBe('true')
    expect(onCommit).toHaveBeenCalledTimes(commitsAfterMount)
  })

  it('cleans up the resize listener and observer on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect')

    const { unmount } = render(<TestComponent attributeKeys={['disabled']} />)
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(disconnectSpy).toHaveBeenCalledOnce()

    removeEventListenerSpy.mockRestore()
    disconnectSpy.mockRestore()
  })

  it('cleans up the resize listener without an observer when the ref never attaches', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<UnattachedComponent attributeKeys={['id']} />)
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

    removeEventListenerSpy.mockRestore()
  })

  function attachElement(ref: { current: HTMLInputElement | null }, props: Partial<HTMLInputElement>) {
    const input = document.createElement('input')
    Object.assign(input, props)
    act(() => {
      ref.current = input
      window.dispatchEvent(new Event('resize'))
    })
  }

  it('defines each attribute value as writable, configurable, and enumerable', () => {
    const { result } = renderHook(() => useElementAttributes<HTMLInputElement, 'disabled'>(['disabled']))
    attachElement(result.current.ref, { disabled: true })

    const descriptor = Object.getOwnPropertyDescriptor(result.current.attributeValues, 'disabled')
    expect(descriptor).toMatchObject({ writable: true, configurable: true, enumerable: true })
  })

  it('updates when at least one of several tracked attributes changes, not only when all of them do', () => {
    const { result } = renderHook(() =>
      useElementAttributes<HTMLInputElement, 'disabled' | 'readOnly'>(['disabled', 'readOnly'])
    )
    attachElement(result.current.ref, { disabled: true, readOnly: true })
    expect(result.current.attributeValues).toEqual({ disabled: true, readOnly: true })

    // Only 'disabled' actually changes - 'readOnly' stays the same - re-read via an ordinary
    // "resize" dispatch (not a fresh attach), so this also proves that dispatch alone re-reads
    // the live DOM element rather than a stale snapshot.
    result.current.ref.current!.disabled = false
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.attributeValues).toEqual({ disabled: false, readOnly: true })
  })

  it('does not update (same object reference) when a resize fires but nothing tracked changed', () => {
    const { result } = renderHook(() => useElementAttributes<HTMLInputElement, 'disabled'>(['disabled']))
    attachElement(result.current.ref, { disabled: true })
    const before = result.current.attributeValues

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.attributeValues).toBe(before)
  })

  it('re-subscribes with the new attributeKeys when the argument array changes identity', () => {
    function Wrapper({ attributeKeys }: { attributeKeys: Array<keyof HTMLInputElement> }) {
      const { ref, attributeValues } = useElementAttributes<HTMLInputElement, keyof HTMLInputElement>(attributeKeys)
      return (
        <div>
          <input ref={ref} disabled readOnly />
          <span data-testid="keys">
            {Object.keys(attributeValues)
              .sort((a, b) => a.localeCompare(b))
              .join(',')}
          </span>
        </div>
      )
    }

    const { getByTestId, rerender } = render(<Wrapper attributeKeys={['disabled']} />)
    expect(getByTestId('keys').textContent).toBe('disabled')

    rerender(<Wrapper attributeKeys={['readOnly']} />)

    expect(getByTestId('keys').textContent).toBe('readOnly')
  })
})

describe('useFormState', () => {
  it('initializes with the given state', () => {
    const { result } = renderHook(() => useFormState({ name: '' }))
    expect(result.current.formState).toEqual({ name: '' })
  })

  it('updates state via handleFormStateValue', () => {
    const { result } = renderHook(() => useFormState({ name: '' }))
    act(() => {
      result.current.handleFormStateValue('name')('bob')
    })
    expect(result.current.formState.name).toBe('bob')
  })

  it('updates state via handleFormStateOnClick', () => {
    const { result } = renderHook(() => useFormState({ count: 0 }))
    act(() => {
      result.current.handleFormStateOnClick('count', 5)()
    })
    expect(result.current.formState.count).toBe(5)
  })

  it('resets state back to the initial value', () => {
    const { result } = renderHook(() => useFormState({ name: '' }))
    act(() => {
      result.current.handleFormStateValue('name')('bob')
    })
    act(() => {
      result.current.resetFormState()
    })
    expect(result.current.formState.name).toBe('')
  })

  it('updates state via handleFormStateEvent from a text change event', () => {
    const { result } = renderHook(() => useFormState({ name: '' }))
    act(() => {
      result.current.handleFormStateEvent('name')({
        target: { type: 'text', value: 'alice' },
      } as unknown as ChangeEvent<HTMLInputElement>)
    })
    expect(result.current.formState.name).toBe('alice')
  })

  it('reads .checked instead of .value for checkbox change events', () => {
    const { result } = renderHook(() => useFormState({ agreed: false }))
    act(() => {
      result.current.handleFormStateEvent('agreed')({
        target: { type: 'checkbox', checked: true },
      } as unknown as ChangeEvent<HTMLInputElement>)
    })
    expect(result.current.formState.agreed).toBe(true)
  })

  it('reads .valueAsNumber instead of .value (a string) for number change events', () => {
    const { result } = renderHook(() => useFormState({ age: 0 }))
    act(() => {
      result.current.handleFormStateEvent('age')({
        target: { type: 'number', valueAsNumber: 25 },
      } as unknown as ChangeEvent<HTMLInputElement>)
    })
    expect(result.current.formState.age).toBe(25)
    expect(typeof result.current.formState.age).toBe('number')
  })

  it('reads .valueAsNumber for range change events too', () => {
    const { result } = renderHook(() => useFormState({ volume: 0 }))
    act(() => {
      result.current.handleFormStateEvent('volume')({
        target: { type: 'range', valueAsNumber: 80 },
      } as unknown as ChangeEvent<HTMLInputElement>)
    })
    expect(result.current.formState.volume).toBe(80)
  })
})

describe('useEffectAfterMount', () => {
  it('does not run the effect on the initial render', () => {
    const effect = vi.fn()
    renderHook(({ dep }) => useEffectAfterMount(effect, [dep]), { initialProps: { dep: 1 } })
    expect(effect).not.toHaveBeenCalled()
  })

  it('runs the effect when dependencies change', () => {
    const effect = vi.fn()
    const { rerender } = renderHook(({ dep }) => useEffectAfterMount(effect, [dep]), { initialProps: { dep: 1 } })
    rerender({ dep: 2 })
    expect(effect).toHaveBeenCalledOnce()
  })

  it('does not run the effect again on a re-render with unchanged dependencies', () => {
    const effect = vi.fn()
    const { rerender } = renderHook(({ dep }) => useEffectAfterMount(effect, [dep]), { initialProps: { dep: 1 } })
    rerender({ dep: 1 })
    expect(effect).not.toHaveBeenCalled()
  })
})

function dispatchPaste(files: File[]) {
  const pasteEvent = new Event('paste') as unknown as ClipboardEvent
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: { files },
  })
  act(() => {
    document.dispatchEvent(pasteEvent)
  })
}

// An exception thrown inside a DOM event listener never propagates to dispatchEvent's caller
// (jsdom matches real browsers here) - it's reported asynchronously via a window 'error' event
// instead, so `expect(() => dispatch(...)).not.toThrow()` can never actually observe one and
// silently passes regardless. This captures that event directly, calling preventDefault() so it
// doesn't also surface as an unhandled rejection and fail the run.
function captureWindowErrors(act_: () => void): unknown[] {
  const captured: unknown[] = []
  const handler = (e: ErrorEvent) => {
    captured.push(e.error)
    e.preventDefault()
  }
  window.addEventListener('error', handler)
  try {
    act_()
  } finally {
    window.removeEventListener('error', handler)
  }
  return captured
}

describe('useFilePaste', () => {
  it('starts with isLoading false, before anything is pasted', () => {
    const { result } = renderHook(() => useFilePaste())
    expect(result.current.isLoading).toBe(false)
  })

  it('captures pasted files matching accepted types', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png'] }))
    dispatchPaste([new File(['data'], 'a.png', { type: 'image/png' })])

    expect(result.current.files).toEqual([new File(['data'], 'a.png', { type: 'image/png' })])
    expect(result.current.error).toBeNull()
  })

  it('treats an empty acceptedTypes array the same as no filter at all', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: [] }))
    const file = new File(['data'], 'a.anything', { type: 'whatever/type' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('rejects files with a disallowed type', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png'] }))
    dispatchPaste([new File(['data'], 'a.txt', { type: 'text/plain' })])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toMatch(/Invalid file types/)
  })

  it('does not treat an exact-match entry as an accidental prefix wildcard', () => {
    // 'text/plain' is listed without a '/*' suffix, so it must only ever match that exact type -
    // a bug that skips filtering out non-wildcard entries before the prefix check would let this
    // through as if 'text/plain' had been a wildcard.
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['text/plain'] }))
    const file = new File(['data'], 'a.bin', { type: 'text/plain-extra' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toMatch(/Invalid file types/)
  })

  it('reports every rejected file by name, comma-separated, alongside the accepted type list', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png', 'image/webp'] }))
    const first = new File(['a'], 'first.txt', { type: 'text/plain' })
    const second = new File(['b'], 'second.txt', { type: 'text/plain' })
    dispatchPaste([first, second])

    expect(result.current.error).toBe(
      'Invalid file types: first.txt, second.txt. Accepted types: image/png, image/webp'
    )
  })

  it('accepts files matching a wildcard accepted type', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/*'] }))
    const file = new File(['data'], 'a.webp', { type: 'image/webp' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('does not let a wildcard match a type that only shares a text prefix', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/*'] }))
    const file = new File(['data'], 'a.bin', { type: 'imagexyz/foo' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toMatch(/Invalid file types/)
  })

  it('normalizes a wildcard entry to its bare category, not left as-is or mis-sliced', () => {
    // 'image/*'.slice(0, -2) is 'image' (used for the *exact*-match list, which is otherwise
    // dead for wildcard entries since no real MIME type is ever bare like this) - a file typed
    // exactly 'image' is the one input that can tell a correct slice apart from a wrong one.
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/*'] }))
    const file = new File(['data'], 'a.bin', { type: 'image' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('rejects files exceeding maxSize, with a precisely computed MB figure', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 2 * 1024 * 1024 }))
    const file = new File(['x'.repeat(3 * 1024 * 1024)], 'big.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toBe('File "big.txt" (3.00 MB) exceeds the maximum size of 2.00 MB')
  })

  it('accepts a file exactly at maxSize, not just strictly under it', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 10 }))
    const file = new File(['x'.repeat(10)], 'at-limit.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('accepts files within maxSize', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 1000 }))
    const file = new File(['small'], 'small.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('treats maxSize: 0 as "no limit", not "reject everything"', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 0 }))
    const file = new File(['not empty'], 'file.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })

  it('clears files and error via clearFiles', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png'] }))
    dispatchPaste([new File(['data'], 'a.png', { type: 'image/png' })])
    expect(result.current.files).toHaveLength(1)

    act(() => {
      result.current.clearFiles()
    })

    expect(result.current.files).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('never attaches a paste listener while disabled', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    renderHook(() => useFilePaste({ enabled: false }))

    expect(addEventListenerSpy).not.toHaveBeenCalledWith('paste', expect.any(Function))
    addEventListenerSpy.mockRestore()
  })

  it('ignores paste events with no clipboardData', () => {
    const { result } = renderHook(() => useFilePaste())

    const event = new Event('paste') as unknown as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: null })
    const errors = captureWindowErrors(() => {
      act(() => {
        document.dispatchEvent(event)
      })
    })

    expect(errors).toEqual([])
    expect(result.current.files).toEqual([])
  })

  it('ignores paste events with an empty file list', () => {
    const { result } = renderHook(() => useFilePaste())
    dispatchPaste([])

    expect(result.current.files).toEqual([])
  })

  it('leaves an empty-file-list paste event alone entirely, without calling preventDefault', () => {
    // `files` ends up [] either way, so this checks a side effect only the early-return path
    // skips: a bug that proceeds anyway (files is truthy even when empty) would still call
    // preventDefault before ultimately landing on the same empty `files` result.
    renderHook(() => useFilePaste())

    const pasteEvent = new Event('paste') as unknown as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [] } })
    const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault')

    act(() => {
      document.dispatchEvent(pasteEvent)
    })

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('listens on a custom target element instead of document when given one', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    const { result } = renderHook(() => useFilePaste({ targetElement: target, acceptedTypes: ['image/png'] }))

    const file = new File(['data'], 'a.png', { type: 'image/png' })
    const pasteEvent = new Event('paste') as unknown as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', { value: { files: [file] } })

    act(() => {
      target.dispatchEvent(pasteEvent)
    })

    expect(result.current.files).toEqual([file])
    document.body.removeChild(target)
  })

  it('removes the paste listener from the custom target element on unmount', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const removeEventListenerSpy = vi.spyOn(target, 'removeEventListener')

    const { unmount } = renderHook(() => useFilePaste({ targetElement: target }))
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('paste', expect.any(Function))
    document.body.removeChild(target)
  })

  it('surfaces a processing error via the caught error message', () => {
    const { result } = renderHook(() => useFilePaste())

    const throwingFiles = {
      length: 1,
      0: new File(['data'], 'a.png', { type: 'image/png' }),
      [Symbol.iterator]() {
        throw new Error('iteration failed')
      },
    }
    const pasteEvent = new Event('paste') as unknown as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { files: throwingFiles },
    })

    act(() => {
      document.dispatchEvent(pasteEvent)
    })

    expect(result.current.error).toBe('iteration failed')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.files).toEqual([])
  })

  it('falls back to a generic message when a non-Error value is thrown', () => {
    const { result } = renderHook(() => useFilePaste())

    const throwingFiles = {
      length: 1,
      0: new File(['data'], 'a.png', { type: 'image/png' }),
      [Symbol.iterator]() {
        // eslint-disable-next-line no-throw-literal
        throw 'not an Error instance'
      },
    }
    const pasteEvent = new Event('paste') as unknown as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { files: throwingFiles },
    })

    act(() => {
      document.dispatchEvent(pasteEvent)
    })

    expect(result.current.error).toBe('Failed to process pasted files')
    expect(result.current.files).toEqual([])
  })

  it('re-validates against the latest acceptedTypes after a rerender with new options', () => {
    const { result, rerender } = renderHook(({ acceptedTypes }) => useFilePaste({ acceptedTypes }), {
      initialProps: { acceptedTypes: ['image/png'] },
    })

    rerender({ acceptedTypes: ['text/plain'] })
    const file = new File(['data'], 'a.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([file])
    expect(result.current.error).toBeNull()
  })
})

function makeDataTransfer(files: File[], items: Array<{ kind: string; type: string }> = []) {
  return { files, items }
}

describe('useFileDragDrop', () => {
  function TestComponent({
    onDrop,
    onDragOver,
    onDragLeave,
    acceptedFileTypes,
    maxFileSize,
    multiple,
  }: {
    onDrop?: (files: File[]) => void
    onDragOver?: (e: unknown) => void
    onDragLeave?: (e: unknown) => void
    acceptedFileTypes?: string[]
    maxFileSize?: number
    multiple?: boolean
  }) {
    const { ref, isDragging, files, reset } = useFileDragDrop<HTMLDivElement>({
      onDrop,
      onDragOver,
      onDragLeave,
      acceptedFileTypes,
      maxFileSize,
      multiple,
    })
    return (
      <div ref={ref} data-testid="dropzone">
        <span data-testid="dragging">{String(isDragging)}</span>
        <span data-testid="files">{files?.length ?? 0}</span>
        <button data-testid="reset" onClick={reset}>
          reset
        </button>
      </div>
    )
  }

  function UnattachedComponent() {
    useFileDragDrop()
    return null
  }

  function dispatch(target: Element, type: string, dataTransfer: unknown) {
    const event = new Event(type, { bubbles: true }) as unknown as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    act(() => {
      target.dispatchEvent(event as unknown as Event)
    })
  }

  it('calls onDrop with the dropped files', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} />)
    const dropzone = getByTestId('dropzone')

    const file = new File(['data'], 'a.png', { type: 'image/png' })
    dispatch(dropzone, 'drop', makeDataTransfer([file]))

    expect(onDrop).toHaveBeenCalledWith([file])
  })

  it('keeps every dropped file by default, not just the first', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} />)

    const first = new File(['a'], 'a.txt', { type: 'text/plain' })
    const second = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([first, second]))

    expect(onDrop).toHaveBeenCalledWith([first, second])
  })

  it('clears isDragging and lands the dropped files in state together', () => {
    const { getByTestId } = render(<TestComponent />)
    const dropzone = getByTestId('dropzone')

    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))
    expect(getByTestId('dragging').textContent).toBe('true')

    dispatch(dropzone, 'drop', makeDataTransfer([new File(['a'], 'a.txt', { type: 'text/plain' })]))

    expect(getByTestId('dragging').textContent).toBe('false')
    expect(getByTestId('files').textContent).toBe('1')
  })

  it('calls onDragOver when dragging over', () => {
    const onDragOver = vi.fn()
    const { getByTestId } = render(<TestComponent onDragOver={onDragOver} />)
    dispatch(getByTestId('dropzone'), 'dragover', makeDataTransfer([]))

    expect(onDragOver).toHaveBeenCalledOnce()
  })

  it('does not throw when dragging over without an onDragOver callback', () => {
    const { getByTestId } = render(<TestComponent />)
    const errors = captureWindowErrors(() => dispatch(getByTestId('dropzone'), 'dragover', makeDataTransfer([])))
    expect(errors).toEqual([])
  })

  it('does not throw on dragleave without an onDragLeave callback', () => {
    const { getByTestId } = render(<TestComponent />)
    const dropzone = getByTestId('dropzone')
    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))

    const errors = captureWindowErrors(() => dispatch(dropzone, 'dragleave', makeDataTransfer([])))

    expect(errors).toEqual([])
  })

  it('does not throw on drop without an onDrop callback', () => {
    const { getByTestId } = render(<TestComponent />)
    const file = new File(['data'], 'a.png', { type: 'image/png' })

    const errors = captureWindowErrors(() => dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file])))

    expect(errors).toEqual([])
  })

  it('sets isDragging on dragenter when items include a matching file', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/*']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('sets isDragging when only some of several dragenter items are valid files, not only if all are', () => {
    const { getByTestId } = render(<TestComponent />)
    dispatch(
      getByTestId('dropzone'),
      'dragenter',
      makeDataTransfer(
        [],
        [
          { kind: 'file', type: 'image/png' },
          { kind: 'string', type: 'text/plain' },
        ]
      )
    )

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('re-subscribes with the new acceptedFileTypes when it changes between renders', () => {
    const { getByTestId, rerender } = render(<TestComponent acceptedFileTypes={['image/png']} />)

    rerender(<TestComponent acceptedFileTypes={['text/plain']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'text/plain' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('sets isDragging on dragenter when no acceptedFileTypes filter is given', () => {
    const { getByTestId } = render(<TestComponent />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'anything/type' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('treats an empty acceptedFileTypes array on dragenter the same as no filter at all', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={[]} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'anything/type' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('accepts a dragenter item matching one of several accepted types, not only if it matches all', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/png', 'image/webp']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/webp' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('accepts a dragenter item matching a non-wildcard type exactly', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/png']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('does not treat a non-wildcard accepted type as an accidental prefix match on dragenter', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/png']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/pngsuffix' }]))

    expect(getByTestId('dragging').textContent).toBe('false')
  })

  it('requires a "/" boundary after the wildcard category on dragenter, not just a shared prefix', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/*']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'images/png' }]))

    expect(getByTestId('dragging').textContent).toBe('false')
  })

  it('ignores non-file items on dragenter', () => {
    const { getByTestId } = render(<TestComponent />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'string', type: 'text/plain' }]))

    expect(getByTestId('dragging').textContent).toBe('false')
  })

  it('ignores dragenter items with a non-matching exact type', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/png']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'text/plain' }]))

    expect(getByTestId('dragging').textContent).toBe('false')
  })

  it('ignores dragenter with an empty items list', () => {
    const { getByTestId } = render(<TestComponent />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], []))

    expect(getByTestId('dragging').textContent).toBe('false')
  })

  it('does not throw on dragenter when dataTransfer.items is absent entirely', () => {
    const { getByTestId } = render(<TestComponent />)
    const errors = captureWindowErrors(() => dispatch(getByTestId('dropzone'), 'dragenter', { files: [] }))
    expect(errors).toEqual([])
  })

  it('resets isDragging to false on dragleave once the counter returns to zero', () => {
    const onDragLeave = vi.fn()
    const { getByTestId } = render(<TestComponent onDragLeave={onDragLeave} />)
    const dropzone = getByTestId('dropzone')

    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))
    expect(getByTestId('dragging').textContent).toBe('true')

    dispatch(dropzone, 'dragleave', makeDataTransfer([]))

    expect(getByTestId('dragging').textContent).toBe('false')
    expect(onDragLeave).toHaveBeenCalledOnce()
  })

  it('stays dragging while the drag counter has not returned to zero (nested enters)', () => {
    const { getByTestId } = render(<TestComponent />)
    const dropzone = getByTestId('dropzone')

    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))
    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))
    dispatch(dropzone, 'dragleave', makeDataTransfer([]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('filters dropped files by exact accepted type', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png']} />)

    const valid = new File(['a'], 'a.png', { type: 'image/png' })
    const invalid = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([valid, invalid]))

    expect(onDrop).toHaveBeenCalledWith([valid])
  })

  it('filters dropped files by wildcard accepted type', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/*']} />)

    const valid = new File(['a'], 'a.webp', { type: 'image/webp' })
    const invalid = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([valid, invalid]))

    expect(onDrop).toHaveBeenCalledWith([valid])
  })

  it('treats an empty acceptedFileTypes array on drop the same as no filter at all', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={[]} />)

    const file = new File(['a'], 'a.anything', { type: 'whatever/type' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file]))

    expect(onDrop).toHaveBeenCalledWith([file])
  })

  it('keeps a dropped file matching one of several accepted types, not only if it matches all', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png', 'image/webp']} />)

    const file = new File(['a'], 'a.webp', { type: 'image/webp' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file]))

    expect(onDrop).toHaveBeenCalledWith([file])
  })

  it('does not treat a non-wildcard accepted type as an accidental prefix match on drop', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png']} />)

    const file = new File(['a'], 'a.bin', { type: 'image/pngsuffix' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file]))

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('requires a "/" boundary after the wildcard category on drop, not just a shared prefix', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/*']} />)

    const file = new File(['a'], 'a.bin', { type: 'images/png' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file]))

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('filters dropped files by maxFileSize, keeping a file exactly at the limit', () => {
    // jsdom File instances have no own enumerable properties (name/size/type are prototype
    // getters), so toHaveBeenCalledWith([atLimit]) would pass no matter which File came through -
    // .name is asserted explicitly so this actually distinguishes the two.
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} maxFileSize={10} />)

    const atLimit = new File(['x'.repeat(10)], 'at-limit.txt', { type: 'text/plain' })
    const big = new File(['x'.repeat(20)], 'big.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([atLimit, big]))

    expect(onDrop).toHaveBeenCalledOnce()
    expect(onDrop.mock.calls[0][0].map((file: File) => file.name)).toEqual(['at-limit.txt'])
  })

  it('keeps only the first file when multiple is false', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} multiple={false} />)

    const first = new File(['a'], 'a.txt', { type: 'text/plain' })
    const second = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([first, second]))

    expect(onDrop).toHaveBeenCalledWith([first])
  })

  it('does not call onDrop when every dropped file is filtered out', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png']} />)

    const invalid = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([invalid]))

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('does not call onDrop when multiple is false and every dropped file is filtered out', () => {
    // With validFiles already empty going into the "keep only the first" step, a bug there could
    // synthesize a bogus [undefined] entry instead of leaving it empty.
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png']} multiple={false} />)

    const invalid = new File(['b'], 'b.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([invalid]))

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('ignores drop events with no files', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} />)
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([]))

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('does not throw on drop when dataTransfer.files is absent entirely', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} />)

    const errors = captureWindowErrors(() => dispatch(getByTestId('dropzone'), 'drop', { items: [] }))

    expect(errors).toEqual([])
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('resets isDragging and files via reset()', () => {
    const { getByTestId } = render(<TestComponent />)
    const dropzone = getByTestId('dropzone')

    dispatch(dropzone, 'drop', makeDataTransfer([new File(['a'], 'a.txt', { type: 'text/plain' })]))
    expect(getByTestId('files').textContent).toBe('1')

    act(() => {
      getByTestId('reset').click()
    })

    expect(getByTestId('dragging').textContent).toBe('false')
    expect(getByTestId('files').textContent).toBe('0')
  })

  it('cleans up drag listeners on unmount', () => {
    const { getByTestId, unmount } = render(<TestComponent />)
    const dropzone = getByTestId('dropzone')
    const removeEventListenerSpy = vi.spyOn(dropzone, 'removeEventListener')

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragenter', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragleave', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', expect.any(Function))
  })

  it('does not attach listeners when the ref never attaches to an element', () => {
    expect(() => render(<UnattachedComponent />).unmount()).not.toThrow()
  })

  it('calls the latest onDragOver after a rerender, not the one captured at mount', () => {
    const firstOnDragOver = vi.fn()
    const secondOnDragOver = vi.fn()
    const { getByTestId, rerender } = render(<TestComponent onDragOver={firstOnDragOver} />)

    rerender(<TestComponent onDragOver={secondOnDragOver} />)
    dispatch(getByTestId('dropzone'), 'dragover', makeDataTransfer([]))

    expect(secondOnDragOver).toHaveBeenCalledOnce()
    expect(firstOnDragOver).not.toHaveBeenCalled()
  })

  it('calls the latest onDragLeave after a rerender, not the one captured at mount', () => {
    const firstOnDragLeave = vi.fn()
    const secondOnDragLeave = vi.fn()
    const { getByTestId, rerender } = render(<TestComponent onDragLeave={firstOnDragLeave} />)
    const dropzone = getByTestId('dropzone')
    dispatch(dropzone, 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))

    rerender(<TestComponent onDragLeave={secondOnDragLeave} />)
    dispatch(dropzone, 'dragleave', makeDataTransfer([]))

    expect(secondOnDragLeave).toHaveBeenCalledOnce()
    expect(firstOnDragLeave).not.toHaveBeenCalled()
  })

  it('re-filters against the latest acceptedFileTypes after a rerender with new options', () => {
    const onDrop = vi.fn()
    const { getByTestId, rerender } = render(<TestComponent onDrop={onDrop} acceptedFileTypes={['image/png']} />)

    rerender(<TestComponent onDrop={onDrop} acceptedFileTypes={['text/plain']} />)
    const file = new File(['a'], 'a.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([file]))

    expect(onDrop).toHaveBeenCalledWith([file])
  })
})
