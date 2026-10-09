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

  it('rejects with the fs error when the file is missing, and logs nothing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(getFileAsString('missing.txt')).rejects.toMatchObject({ code: 'ENOENT' })

    expect(consoleError).not.toHaveBeenCalled()
  })
})
