type MimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export function guessImageMimeType(filename: string): MimeType {
  const withoutQueryOrHash = filename.split(/[?#]/)[0]
  // Stryker disable next-line OptionalChaining: equivalent mutant. String#split always returns at
  // least one element for any input (including ''), so .pop() here can never actually be
  // undefined - the `?.` exists only to satisfy Array#pop()'s TypeScript signature.
  const extension = withoutQueryOrHash.split('.').pop()?.toLowerCase()
  switch (extension) {
    // Stryker disable next-line StringLiteral: equivalent mutant. This case and `default` below
    // both return 'image/png', so no input can distinguish which of the two branches ran it.
    case 'png':
      return 'image/png'
    case 'jfif':
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    default:
      return 'image/png'
  }
}

export function isImageMimeType(mimeType: string): mimeType is MimeType {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
}

export function escapeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_.]/g, '_')
}

export function safeFileName(filename: string, maxLength: number = 255): string {
  if (filename.length <= maxLength) return filename

  const dotIndex = filename.lastIndexOf('.')
  const hasExtension = dotIndex > 0
  const extension = escapeName(hasExtension ? filename.slice(dotIndex) : '')
  // Stryker disable next-line MethodExpression: equivalent mutant. This branch only runs when
  // filename.length > maxLength, and escapeName preserves length, so
  // maxLength - extension.length < maxLength - (filename.length - dotIndex) = dotIndex always
  // holds. The slice below therefore never reads past index dotIndex, which is exactly where
  // filename and filename.slice(0, dotIndex) still agree - dropping the slice can't change it.
  const name = escapeName(hasExtension ? filename.slice(0, dotIndex) : filename)

  return name.slice(0, Math.max(0, maxLength - extension.length)) + extension
}

export async function downloadAndFormatImage(
  src: string,
  name: string = 'image.png',
  mimeType: MimeType = guessImageMimeType(name),
  quality: number = 1
): Promise<void> {
  name = safeFileName(name)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = src
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      throw new Error('Could not get canvas context')
    }

    ctx.drawImage(img, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, quality)
    })

    if (!blob) {
      throw new Error('Could not generate blob')
    }

    const link = document.createElement('a')
    const downloadUrl = URL.createObjectURL(blob)
    try {
      link.href = downloadUrl
      link.download = name
      document.body.appendChild(link)
      link.click()
    } finally {
      document.body.removeChild(link)
      URL.revokeObjectURL(downloadUrl)
    }
  } catch (error) {
    console.error('Failed to download image:', error)
  }
}

export async function fileToBase64Native(file: File): Promise<string> {
  const result = await new Promise<string | ArrayBuffer | null>((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = (error) => reject(error)
  })

  if (typeof result === 'string') {
    return result
  } else {
    throw new Error('Failed to read file as Data URL')
  }
}

export async function fileToBase64(file: File, quality: number = 1): Promise<string> {
  if (isImageMimeType(file.type)) {
    const img = new Image()
    const url = URL.createObjectURL(file)
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image for metadata removal'))
        img.src = url
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Failed to get canvas context')
      }
      ctx.drawImage(img, 0, 0)

      const cleanDataUrl = canvas.toDataURL(file.type, quality)
      if (cleanDataUrl === 'data:,') {
        return await fileToBase64Native(file)
      }

      return cleanDataUrl
    } finally {
      URL.revokeObjectURL(url)
    }
  } else {
    return await fileToBase64Native(file)
  }
}
