export function getCookie(name: string): string | undefined {
  for (const pair of document.cookie.split('; ')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    if (pair.slice(0, separatorIndex) === name) {
      return pair.slice(separatorIndex + 1)
    }
  }
  return undefined
}
