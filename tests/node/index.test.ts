// @vitest-environment node
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFileAsString } from '../../src/node'

describe('getFileAsString', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'isik-core-'))
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('reads a file relative to the current working directory', async () => {
    await fs.writeFile(path.join(tempDir, 'hello.txt'), 'hello world')
    expect(await getFileAsString('hello.txt')).toBe('hello world')
  })

  it('returns an error message string instead of throwing when the file is missing', async () => {
    const result = await getFileAsString('missing.txt')
    expect(result).toMatch(/^Error reading file: /)
  })

  it('logs the filename alongside the raw error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await getFileAsString('missing.txt')

    expect(consoleError).toHaveBeenCalledWith('Error reading file missing.txt:', expect.anything())
  })

  it('stringifies non-Error throws instead of reading .message', async () => {
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce('a plain string rejection')

    const result = await getFileAsString('whatever.txt')

    expect(result).toBe('Error reading file: a plain string rejection')
  })
})
