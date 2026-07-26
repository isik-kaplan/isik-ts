export function slugify(value: string, allowUnicode: boolean = false): string {
  if (allowUnicode) {
    value = value.normalize('NFKC').replace(/[^\p{L}\p{N}_\s-]/gu, '')
  } else {
    value = value
      .normalize('NFKD')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .replace(/[^\w\s-]/g, '')
  }

  value = value.toLowerCase()

  return value.replace(/[-\s]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}
