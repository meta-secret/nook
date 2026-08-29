import { posix } from 'node:path';
import { resolveWord } from './skill-provider-shell-environment.ts';
import type {
  ShellEnvironment,
  ShellParseState,
  RuntimeExecutable,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

const REDIRECTION = /^(?:\d+)?(?:>>?|<<?|<>|>&|<&|&>>?)/u;
const ASSIGNMENT = /^[A-Za-z_]\w*\+?=/u;
const ABSOLUTE_RUNTIME =
  /^\/(?:usr\/(?:local\/)?bin|opt\/homebrew\/bin)\/(bun|node|bash|sh)$|^\/bin\/(bash|sh)$/u;
const SCRIPT_DIRECTORY_EXPRESSION =
  /^\$\(dirname (?:-- )?["']?(?:\$0|\$\{BASH_SOURCE\[0\]\})["']?\)$/u;

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

export function isolatedShellState(state: ShellParseState): ShellParseState {
  return {
    ...state,
    aliases: new Map(state.aliases),
    environment: new Map(state.environment),
    functions: new Map(state.functions),
  };
}

export function restoreShellState([target, snapshot]: readonly [
  ShellParseState,
  ShellParseState,
]): void {
  target.aliases.clear();
  for (const [name, value] of snapshot.aliases) target.aliases.set(name, value);
  target.cwd = snapshot.cwd;
  target.cwdProtected = snapshot.cwdProtected;
  target.cwdUnknown = snapshot.cwdUnknown;
  target.environment.clear();
  for (const [name, value] of snapshot.environment)
    target.environment.set(name, value);
  target.functions.clear();
  for (const [name, value] of snapshot.functions)
    target.functions.set(name, value);
  target.positionalArguments = snapshot.positionalArguments;
}

export function shellStdinConsumer(words: readonly ShellWord[]): boolean {
  let index = 0;
  while (['builtin', 'command', 'exec'].includes(words[index]?.value ?? ''))
    index += 1;
  if (!['bash', 'sh'].includes(normalizedRuntime(words[index]?.value ?? '')))
    return false;
  return words.slice(index + 1).every((word) => word.value.startsWith('-'));
}

export function applySetPositional([state, words, start]: readonly [
  ShellParseState,
  readonly ShellWord[],
  number,
]): boolean {
  if (words[start]?.value !== '--') return false;
  state.positionalArguments = words.slice(start + 1).map((word) => {
    const request: WordEnvironmentRequest = {
      environment: state.environment,
      word,
    };
    return resolveWord(request);
  });
  return true;
}

export function nodeInspectExecutables([words, start]: readonly [
  readonly ShellWord[],
  number,
]): readonly RuntimeExecutable[] | false {
  const executable = words
    .slice(start)
    .find((word) => !word.value.startsWith('-'));
  return executable ? [{ executable, arguments: [] }] : false;
}

function cdOperandIndex([words, start, environment]: readonly [
  readonly ShellWord[],
  number,
  ShellEnvironment,
]): number | false {
  let index = start;
  for (; index < words.length; index += 1) {
    const wordRequest: WordEnvironmentRequest = {
      environment,
      word: words[index] as ShellWord,
    };
    const word = resolveWord(wordRequest);
    if (word.value === '--') return words[index + 1] ? index + 1 : false;
    if (!word.value.startsWith('-') || word.value === '-') return index;
    if (word.dynamic) throw new Error('Dynamic cd option is forbidden.');
    if (!/^-[LPe@]+$/u.test(word.value))
      throw new Error(`Unsupported cd option: ${word.value}`);
  }
  return false;
}

export function applyCd([state, words, start]: readonly [
  ShellParseState,
  readonly ShellWord[],
  number,
]): void {
  const operandIndex = cdOperandIndex([words, start, state.environment]);
  if (operandIndex === false) return;
  const request: WordEnvironmentRequest = {
    environment: state.environment,
    word: words[operandIndex] as ShellWord,
  };
  const directory = resolveWord(request);
  if (SCRIPT_DIRECTORY_EXPRESSION.test(directory.value)) return;
  if (directory.dynamic) {
    state.cwd = '';
    state.cwdProtected = false;
    state.cwdUnknown = true;
    return;
  }
  state.cwdProtected = false;
  state.cwdUnknown = false;
  state.cwd = posix.normalize(posix.join(state.cwd, directory.value));
}
