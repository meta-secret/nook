import { describe, expect, test } from 'bun:test'
import { flagPresent, positionalArgs, requireOption } from '../src/lib/args.ts'
import { ResultKind } from '../src/result.ts'

describe('args helpers', () => {
  test('reads required options and positionals', () => {
    const args = ['assemble', '--pr', '12', '--scratch', 'a.json', '--inventory']
    expect(positionalArgs(args)).toEqual(['assemble'])
    expect(flagPresent(args, '--inventory')).toBe(true)
    const pr = requireOption(args, '--pr')
    expect(pr.kind).toBe(ResultKind.Ok)
    if (pr.kind === ResultKind.Ok) {
      expect(pr.value).toBe('12')
    }
  })
})
