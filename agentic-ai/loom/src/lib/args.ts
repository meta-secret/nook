import { absent, err, ok, present, type Maybe, type Result } from '../result.ts'

export function flagPresent(args: readonly string[], name: string): boolean {
  return args.includes(name)
}

export function readOption(
  args: readonly string[],
  name: string,
): Result<Maybe<string>> {
  const index = args.indexOf(name)
  if (index < 0) {
    return ok(absent())
  }
  const value = args[index + 1]
  if (typeof value !== 'string' || value.startsWith('--')) {
    return err(`Missing value for ${name}`)
  }
  return ok(present(value))
}

export function requireOption(
  args: readonly string[],
  name: string,
): Result<string> {
  const option = readOption(args, name)
  if (option.kind === 'err') {
    return option
  }
  if (option.value.kind === 'absent') {
    return err(`Required option ${name} is missing`)
  }
  return ok(option.value.value)
}

export function positionalArgs(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (typeof token !== 'string') {
      continue
    }
    if (token.startsWith('--')) {
      const next = args[i + 1]
      if (typeof next === 'string' && !next.startsWith('--')) {
        i += 1
      }
      continue
    }
    out.push(token)
  }
  return out
}
