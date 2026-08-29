import type { ShellWord } from './skill-provider-command-types.ts';

const REDIRECTION = /^(?:\d+)?(?:>>?|<<?|<>|>&|<&|&>>?)/u;
const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/u;
const ABSOLUTE_RUNTIME =
  /^\/(?:usr\/(?:local\/)?bin|opt\/homebrew\/bin)\/(bun|node|bash|sh)$|^\/bin\/(bash|sh)$/u;

export function withoutLeadingRedirections(
  input: readonly ShellWord[],
): readonly ShellWord[] {
  const words = [...input];
  for (let index = 0; index < words.length;) {
    const value = words[index]?.value ?? '';
    if (ASSIGNMENT.test(value)) {
      index += 1;
      continue;
    }
    const match = value.match(REDIRECTION)?.[0];
    if (!match) break;
    const count = match === value ? 2 : 1;
    if (count === 2 && !words[index + 1])
      throw new Error('Shell redirection has no target.');
    words.splice(index, count);
  }
  return words;
}

export function normalizedRuntime(value: string): string {
  const match = value.match(ABSOLUTE_RUNTIME);
  return match?.[1] ?? match?.[2] ?? value;
}

export function cdOperandIndex([words, start]: readonly [
  readonly ShellWord[],
  number,
]): number | false {
  let index = start;
  for (; index < words.length; index += 1) {
    const word = words[index] as ShellWord;
    if (word.dynamic) throw new Error('Dynamic cd option is forbidden.');
    if (word.value === '--') return words[index + 1] ? index + 1 : false;
    if (!word.value.startsWith('-') || word.value === '-') return index;
    if (!/^-[LPe@]+$/u.test(word.value))
      throw new Error(`Unsupported cd option: ${word.value}`);
  }
  return false;
}
