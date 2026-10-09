import fs from 'fs/promises'
import path from 'path'

/** Throws what `fs` throws: an error read as the file's content would reach a person. */
export async function getFileAsString(filename: string): Promise<string> {
  return await fs.readFile(path.join(process.cwd(), filename), 'utf8')
}
