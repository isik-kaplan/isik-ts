import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { parse } from 'yaml'

import { type GenerateOptions, generateClient } from '.'

const USAGE = `Usage: isikk-gen-client <openapi.yml|openapi.json> -o <client.ts> [options]

  -o, --out <file>          where to write the client
  --types <path>            the openapi-typescript output, as the client imports it (default ./schema)
  --keys <rule>             every-write (default), declared or minted
  --strip-prefix <prefix>   taken off each path before naming its resource (default: the shared prefix)
`

export interface Io {
  read: (path: string) => string
  write: (path: string, content: string) => void
  out: (text: string) => void
  err: (text: string) => void
}

const SYSTEM: Io = {
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, content) => writeFileSync(path, content),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}

/** Runs the command; answers its exit code. */
export function main(argv: string[], io: Io = SYSTEM): number {
  const flags: Record<string, string> = {}
  const inputs: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      io.out(USAGE)
      return 0
    }
    if (!arg.startsWith('-')) {
      inputs.push(arg)
      continue
    }
    const name = arg === '-o' ? '--out' : arg
    if (!['--out', '--types', '--keys', '--strip-prefix'].includes(name) || argv[i + 1] === undefined) {
      io.err(
        `isikk-gen-client: ${argv[i + 1] === undefined ? `${arg} needs a value` : `unknown option ${arg}`}\n\n${USAGE}`
      )
      return 2
    }
    flags[name] = argv[(i += 1)]
  }
  if (inputs.length !== 1 || flags['--out'] === undefined) {
    io.err(USAGE)
    return 2
  }
  const [input] = inputs
  try {
    const text = io.read(input)
    const document: unknown = /\.json$/i.test(input) ? JSON.parse(text) : parse(text)
    const options: GenerateOptions = {
      types: flags['--types'],
      keys: flags['--keys'] as GenerateOptions['keys'],
      stripPrefix: flags['--strip-prefix'],
      source: basename(input),
    }
    const { code, warnings } = generateClient(document, options)
    io.write(flags['--out'], code)
    for (const warning of warnings) io.err(`isikk-gen-client: ${warning}\n`)
    return 0
  } catch (error) {
    io.err(`isikk-gen-client: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
