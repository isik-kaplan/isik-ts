'use server'

import { cookies } from 'next/headers'

export async function setCookie(name: string, value: string): Promise<void> {
  ;(await cookies()).set(name, value)
}

export async function getCookie(name: string): Promise<string | null> {
  return (await cookies()).get(name)?.value ?? null
}

export async function removeCookie(name: string): Promise<void> {
  ;(await cookies()).delete(name)
}
