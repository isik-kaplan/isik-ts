import { fc, test } from '@fast-check/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  downloadAndFormatImage,
  escapeName,
  fileToBase64,
  fileToBase64Native,
  guessImageMimeType,
  isImageMimeType,
  safeFileName,
} from '../../src/files'

function createMockImage(shouldSucceed: boolean = true) {
  return class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 10
    height = 10
    crossOrigin?: string
    private _src = ''

    set src(value: string) {
      this._src = value
      queueMicrotask(() => (shouldSucceed ? this.onload?.() : this.onerror?.()))
    }

    get src() {
      return this._src
    }
  }
}

describe('guessImageMimeType', () => {
  it('maps common extensions to their mime type', () => {
    expect(guessImageMimeType('a.png')).toBe('image/png')
    expect(guessImageMimeType('a.jpg')).toBe('image/jpeg')
    expect(guessImageMimeType('a.jpeg')).toBe('image/jpeg')
    expect(guessImageMimeType('a.jfif')).toBe('image/jpeg')
    expect(guessImageMimeType('a.webp')).toBe('image/webp')
  })

  it('defaults to png for unknown or missing extensions', () => {
    expect(guessImageMimeType('a.bmp')).toBe('image/png')
    expect(guessImageMimeType('noextension')).toBe('image/png')
  })

  it('ignores query strings and hash fragments when reading the extension', () => {
    expect(guessImageMimeType('https://cdn.example.com/photo.jpg?w=800&h=600')).toBe('image/jpeg')
    expect(guessImageMimeType('https://cdn.example.com/photo.webp#preview')).toBe('image/webp')
  })

  test.prop([fc.string()])('always returns one of the three supported mime types, for any input', (value) => {
    expect(isImageMimeType(guessImageMimeType(value))).toBe(true)
  })
})

describe('isImageMimeType', () => {
  it('accepts the three supported mime types', () => {
    expect(isImageMimeType('image/png')).toBe(true)
    expect(isImageMimeType('image/jpeg')).toBe(true)
    expect(isImageMimeType('image/webp')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isImageMimeType('image/gif')).toBe(false)
    expect(isImageMimeType('text/plain')).toBe(false)
  })
})

describe('escapeName', () => {
  it('replaces invalid filename characters with underscores', () => {
    expect(escapeName('my file (1).png')).toBe('my_file__1_.png')
  })

  test.prop([fc.string()])(
    'output is always the same length as the input, and only ever contains safe characters',
    (value) => {
      const result = escapeName(value)
      expect(result.length).toBe(value.length)
      expect(result).toMatch(/^[a-zA-Z0-9\-_.]*$/)
    }
  )
})

describe('safeFileName', () => {
  it('returns the filename unchanged when under the max length', () => {
    expect(safeFileName('short.png')).toBe('short.png')
  })

  it('truncates long filenames while preserving the extension', () => {
    const longName = 'a'.repeat(300) + '.png'
    const result = safeFileName(longName, 10)
    expect(result.length).toBe(10)
    expect(result.endsWith('.png')).toBe(true)
  })

  it('truncates the name portion to nothing when the extension alone exceeds maxLength, but the extension itself is never truncated - result can still exceed maxLength', () => {
    const result = safeFileName('abcdefgh.png', 3)
    expect(result).toBe('.png')
    expect(result.length).toBeGreaterThan(3)
  })

  it('escapes unsafe characters on extensionless filenames instead of leaking them through raw', () => {
    const longName = '???' + 'a'.repeat(20)
    const result = safeFileName(longName, 10)
    expect(result).not.toContain('?')
    expect(result.length).toBe(10)
  })

  it('treats a filename with no extension as pure name, not a one-character extension', () => {
    const result = safeFileName('a'.repeat(300), 10)
    expect(result.length).toBe(10)
  })

  it('treats a leading dot (dotfile) as pure name too, not an extension covering the whole name', () => {
    // dotIndex is 0 here, not merely absent (-1) - a `> 0` check must exclude it explicitly
    // rather than just excluding "no dot at all", or the entire filename gets treated as an
    // untruncated "extension" and the maxLength budget is never enforced.
    const result = safeFileName('.' + 'a'.repeat(300), 10)
    expect(result.length).toBe(10)
  })

  it('leaves an already-short filename completely untouched, without re-escaping it', () => {
    // Long enough that the early return is the *only* thing that can produce this exact string -
    // any pass through the truncate/re-escape logic below would replace the '?' even though the
    // result still fits, since that logic doesn't know the input was already left alone.
    expect(safeFileName('a?.png', 6)).toBe('a?.png')
  })

  test.prop([fc.string({ minLength: 1, maxLength: 500 }), fc.integer({ min: 10, max: 30 })])(
    'never exceeds maxLength when the extension is short relative to it',
    (name, maxLength) => {
      const withShortExtension = `${name}.png`
      expect(safeFileName(withShortExtension, maxLength).length).toBeLessThanOrEqual(maxLength)
    }
  )
})

describe('fileToBase64Native', () => {
  it('reads a file as a base64 data URL', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = await fileToBase64Native(file)
    expect(result).toMatch(/^data:text\/plain;base64,/)
  })

  it('throws when the FileReader result is not a string', async () => {
    class NonStringResultFileReader {
      onload: (() => void) | null = null
      onerror: ((error: unknown) => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL() {
        this.result = new ArrayBuffer(0)
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('FileReader', NonStringResultFileReader)

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await expect(fileToBase64Native(file)).rejects.toThrow('Failed to read file as Data URL')

    vi.unstubAllGlobals()
  })

  it('rejects when the FileReader itself errors', async () => {
    class ErroringFileReader {
      onload: (() => void) | null = null
      onerror: ((error: unknown) => void) | null = null
      result: string | ArrayBuffer | null = null

      readAsDataURL() {
        queueMicrotask(() => this.onerror?.(new Error('read failed')))
      }
    }
    vi.stubGlobal('FileReader', ErroringFileReader)

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await expect(fileToBase64Native(file)).rejects.toThrow('read failed')

    vi.unstubAllGlobals()
  })
})

describe('fileToBase64', () => {
  it('delegates to fileToBase64Native for non-image files', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const result = await fileToBase64(file)
    expect(result).toMatch(/^data:text\/plain;base64,/)
  })

  it('delegates to fileToBase64Native for image types outside the supported raster set, instead of rasterizing them', async () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const file = new File(['<svg></svg>'], 'icon.svg', { type: 'image/svg+xml' })

    const result = await fileToBase64(file)

    expect(result).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(getContextSpy).not.toHaveBeenCalled()
  })

  describe('with image files', () => {
    beforeEach(() => {
      vi.stubGlobal('Image', createMockImage())
      vi.stubGlobal('URL', {
        ...URL,
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mockdata')
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('returns a canvas-rendered data URL for image files', async () => {
      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })
      const result = await fileToBase64(file)
      expect(result).toBe('data:image/png;base64,mockdata')
    })

    it('falls back to fileToBase64Native when the canvas produces an empty data URL', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,')
      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })
      const result = await fileToBase64(file)
      expect(result).toMatch(/^data:image\/png;base64,/)
      expect(result).not.toBe('data:,')
    })

    it('rejects when the canvas context is unavailable', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })
      await expect(fileToBase64(file)).rejects.toThrow('Failed to get canvas context')
    })

    it('requests a 2d rendering context', async () => {
      const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D)
      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })

      await fileToBase64(file)

      expect(getContextSpy).toHaveBeenCalledWith('2d')
    })

    it('revokes the object URL created for the image after use', async () => {
      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })

      await fileToBase64(file)

      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    })

    it('rejects when the image fails to load', async () => {
      vi.stubGlobal('Image', createMockImage(false))

      const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' })
      await expect(fileToBase64(file)).rejects.toThrow('Failed to load image for metadata removal')
    })
  })
})

describe('downloadAndFormatImage', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', createMockImage())
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      // Real browsers always invoke toBlob's callback asynchronously - never synchronously,
      // even for tiny/cached canvases. Mocking it synchronously would mask bugs where the
      // callback's error handling isn't actually reachable by the surrounding try/catch.
      setTimeout(() => callback(new Blob(['mock'])), 0)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('triggers a download link click for the rendered image', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.png', 'photo.png')

    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('defaults the download filename to image.png when name is omitted', async () => {
    const downloadSetSpy = vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.png')

    expect(downloadSetSpy).toHaveBeenCalledWith('image.png')
  })

  it('marks the image as cross-origin before loading it, so a tainted canvas cannot silently fail toBlob', async () => {
    const instances: Array<{ crossOrigin?: string }> = []
    vi.stubGlobal(
      'Image',
      class extends createMockImage() {
        constructor() {
          super()
          instances.push(this)
        }
      }
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.png', 'photo.png')

    expect(instances).toHaveLength(1)
    expect(instances[0].crossOrigin).toBe('anonymous')
  })

  it('cleans up the link element and the object URL after a successful download', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const removeChildSpy = vi.spyOn(document.body, 'removeChild')

    await downloadAndFormatImage('https://example.com/photo.png', 'photo.png')

    expect(removeChildSpy).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('requests a 2d rendering context', async () => {
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.png', 'photo.png')

    expect(getContextSpy).toHaveBeenCalledWith('2d')
  })

  it('defaults the re-encoded mime type to match the output filename, not the source URL', async () => {
    const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      mimeType
    ) {
      setTimeout(() => callback(new Blob(['mock'], { type: mimeType ?? '' })), 0)
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.jpg', 'export.webp')

    expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 1)
  })

  it('logs instead of throwing when the canvas context is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await downloadAndFormatImage('https://example.com/photo.png', 'photo.png')

    expect(errorSpy).toHaveBeenCalledWith('Failed to download image:', new Error('Could not get canvas context'))
  })

  it('logs instead of throwing when blob generation fails, even with a genuinely async callback', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      setTimeout(() => callback(null), 0)
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(downloadAndFormatImage('https://example.com/photo.png', 'photo.png')).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('Failed to download image:', new Error('Could not generate blob'))
  })
})
