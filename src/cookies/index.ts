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

export interface SetCookieOptions {
  /** Days until the cookie expires. Omit for a session cookie (cleared when the browser closes). */
  days?: number
  path?: string
}

export function setCookie(name: string, value: string, options: SetCookieOptions = {}): void {
  const { days, path = '/' } = options
  const expires = days === undefined ? '' : `; expires=${new Date(Date.now() + days * 86_400_000).toUTCString()}`
  document.cookie = `${name}=${value}${expires}; path=${path}`
}

export function removeCookie(name: string, path: string = '/'): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${path}`
}
