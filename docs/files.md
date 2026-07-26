# files

Browser-only file/image helpers - filename sanitizing, MIME type guessing, and canvas-based image conversion. No dependencies beyond the DOM (`Image`, `canvas`, `FileReader`).

## guessImageMimeType / isImageMimeType

Guesses an image MIME type from a filename's extension (defaulting to `image/png` for anything unrecognized), and a type guard for the three supported MIME types.

```typescript
import { guessImageMimeType, isImageMimeType } from '@isikk/core'

guessImageMimeType('photo.jpg') // 'image/jpeg'
guessImageMimeType('photo.bmp') // 'image/png' - unknown extensions default to png

isImageMimeType('image/webp') // true
isImageMimeType('image/gif') // false
```

## escapeName / safeFileName

`escapeName` replaces characters outside `[a-zA-Z0-9-_.]` with underscores. `safeFileName` additionally truncates a filename to `maxLength` (default 255) while preserving its extension - both the name and the extension are escaped, and a filename with no `.` is treated as pure name (no extension carved out of it).

```typescript
import { escapeName, safeFileName } from '@isikk/core'

escapeName('my file (1).png') // 'my_file__1_.png'
safeFileName('short.png') // 'short.png' - under the limit, returned unchanged
safeFileName('a'.repeat(300) + '.png', 10) // 10 chars total, still ends in '.png'
```

- The extension itself is never truncated. If `maxLength` is smaller than the (escaped) extension's own length, the result can still exceed `maxLength` - `safeFileName('abcdefgh.png', 3)` returns `'.png'` (4 chars). In practice `maxLength` is expected to be a real filesystem limit (default 255), not a handful of characters, so this only matters for deliberately-tiny limits.

## downloadAndFormatImage

Downloads an image from a URL, re-encodes it to the given MIME type/quality via `<canvas>`, and triggers a browser download. Defaults the filename to `'image.png'`, and the MIME type to whatever `guessImageMimeType(name)` implies - i.e. it defaults to _matching the saved file's extension_, not the source URL's format, so the downloaded bytes and the filename you see in your downloads folder never silently disagree.

```typescript
import { downloadAndFormatImage } from '@isikk/core'

await downloadAndFormatImage('https://example.com/photo.png', 'photo.webp', 'image/webp', 0.9)
```

- If you want to keep the source image's original format while just renaming it, pass `mimeType` explicitly (e.g. `guessImageMimeType(src)`) - otherwise a source `.jpg` saved as `'export.png'` gets re-encoded to actual PNG bytes, not just relabeled.

- Errors (failed load, missing canvas context, blob generation failure) are caught and logged via `console.error` rather than thrown - this is a fire-and-forget browser action, not something callers are expected to `try`/`catch` around.

## fileToBase64Native / fileToBase64

`fileToBase64Native` reads any `File` as a base64 data URL via `FileReader`, unmodified. `fileToBase64` additionally strips image metadata by round-tripping files through `<canvas>` first - but only for the three raster types this package actually supports (`isImageMimeType`: PNG/JPEG/WebP). Anything else, including other `image/*` types like SVG or GIF, falls back to `fileToBase64Native` untouched, since running a vector format like SVG through `<canvas>` would silently rasterize it to a fixed-size PNG instead of "stripping metadata."

```typescript
import { fileToBase64, fileToBase64Native } from '@isikk/core'

const raw = await fileToBase64Native(file) // no metadata stripping
const clean = await fileToBase64(file) // strips EXIF/metadata for image/png, image/jpeg, image/webp files
```
