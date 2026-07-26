import { act, render, renderHook } from '@testing-library/react'

import type { ChangeEvent } from 'react'

import { describe, expect, it, vi } from 'vitest'

import { useEffectAfterMount, useElementAttributes, useFileDragDrop, useFilePaste, useFormState } from '../../src/hooks'

describe('useElementAttributes', () => {
  function TestComponent({ attributeKeys }: { attributeKeys: Array<keyof HTMLInputElement> }) {
    const { ref, attributeValues } = useElementAttributes<HTMLInputElement, keyof HTMLInputElement>(attributeKeys)
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
    const { getByTestId } = render(<TestComponent attributeKeys={['disabled']} />)
    expect(getByTestId('value').textContent).toBe('true')

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(getByTestId('value').textContent).toBe('true')
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

describe('useFilePaste', () => {
  it('captures pasted files matching accepted types', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png'] }))
    dispatchPaste([new File(['data'], 'a.png', { type: 'image/png' })])

    expect(result.current.files).toEqual([new File(['data'], 'a.png', { type: 'image/png' })])
    expect(result.current.error).toBeNull()
  })

  it('rejects files with a disallowed type', () => {
    const { result } = renderHook(() => useFilePaste({ acceptedTypes: ['image/png'] }))
    dispatchPaste([new File(['data'], 'a.txt', { type: 'text/plain' })])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toMatch(/Invalid file types/)
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

  it('rejects files exceeding maxSize', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 10 }))
    const file = new File(['x'.repeat(20)], 'big.txt', { type: 'text/plain' })
    dispatchPaste([file])

    expect(result.current.files).toEqual([])
    expect(result.current.error).toMatch(/exceeds the maximum size/)
  })

  it('accepts files within maxSize', () => {
    const { result } = renderHook(() => useFilePaste({ maxSize: 1000 }))
    const file = new File(['small'], 'small.txt', { type: 'text/plain' })
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
    act(() => {
      document.dispatchEvent(event)
    })

    expect(result.current.files).toEqual([])
  })

  it('ignores paste events with an empty file list', () => {
    const { result } = renderHook(() => useFilePaste())
    dispatchPaste([])

    expect(result.current.files).toEqual([])
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

  it('calls onDragOver when dragging over', () => {
    const onDragOver = vi.fn()
    const { getByTestId } = render(<TestComponent onDragOver={onDragOver} />)
    dispatch(getByTestId('dropzone'), 'dragover', makeDataTransfer([]))

    expect(onDragOver).toHaveBeenCalledOnce()
  })

  it('does not throw when dragging over without an onDragOver callback', () => {
    const { getByTestId } = render(<TestComponent />)
    expect(() => dispatch(getByTestId('dropzone'), 'dragover', makeDataTransfer([]))).not.toThrow()
  })

  it('sets isDragging on dragenter when items include a matching file', () => {
    const { getByTestId } = render(<TestComponent acceptedFileTypes={['image/*']} />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'image/png' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
  })

  it('sets isDragging on dragenter when no acceptedFileTypes filter is given', () => {
    const { getByTestId } = render(<TestComponent />)
    dispatch(getByTestId('dropzone'), 'dragenter', makeDataTransfer([], [{ kind: 'file', type: 'anything/type' }]))

    expect(getByTestId('dragging').textContent).toBe('true')
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

  it('filters dropped files by maxFileSize', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} maxFileSize={10} />)

    const small = new File(['a'], 'small.txt', { type: 'text/plain' })
    const big = new File(['x'.repeat(20)], 'big.txt', { type: 'text/plain' })
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([small, big]))

    expect(onDrop).toHaveBeenCalledWith([small])
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

  it('ignores drop events with no files', () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<TestComponent onDrop={onDrop} />)
    dispatch(getByTestId('dropzone'), 'drop', makeDataTransfer([]))

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
})
