import { posix } from 'node:path';
import { resolveWord } from './skill-provider-shell-environment.ts';
import type {
  RuntimeCommandRequest,
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
    const source = words[index]?.source ?? '';
    const match = source.match(REDIRECTION)?.[0];
    if (!match) break;
    const count = match === source ? 2 : 1;
    if (count === 2 && !words[index + 1])
      throw new Error('Shell redirection has no target.');
    words.splice(index, count);
  }
  return words;
}

export function hasLeadingStdinRedirection(
  words: readonly ShellWord[],
): boolean {
  for (let index = 0; index < words.length;) {
    const word = words[index] as ShellWord;
    if (ASSIGNMENT.test(word.value)) {
      index += 1;
      continue;
    }
    const match = word.source.match(REDIRECTION)?.[0];
    if (!match) return false;
    if (/^0*</u.test(match)) return true;
    index += match === word.source ? 2 : 1;
  }
  return false;
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

export function mergeConditionalShellState([target, snapshot]: readonly [
  ShellParseState,
  ShellParseState,
]): void {
  if (
    !mapsEqual([target.aliases, snapshot.aliases]) ||
    !mapsEqual([target.functions, snapshot.functions])
  )
    throw new Error('Conditional shell definition mutation is forbidden.');
  if (
    target.cwd !== snapshot.cwd ||
    target.cwdProtected !== snapshot.cwdProtected ||
    target.cwdUnknown !== snapshot.cwdUnknown
  ) {
    target.cwd = '';
    target.cwdProtected ||= snapshot.cwdProtected;
    target.cwdUnknown = true;
  }
  for (const name of new Set([
    ...target.environment.keys(),
    ...snapshot.environment.keys(),
  ])) {
    const after = target.environment.get(name);
    const before = snapshot.environment.get(name);
    if (after?.source === before?.source && after?.value === before?.value)
      continue;
    target.environment.set(name, mergedWord([before ?? false, after ?? false]));
  }
  const afterArguments = target.positionalArguments;
  const beforeArguments = snapshot.positionalArguments;
  if (afterArguments === beforeArguments) return;
  if (!afterArguments || !beforeArguments) {
    const available = afterArguments || beforeArguments;
    if (!available) return;
    target.positionalArguments = [...available.keys()].map((index) =>
      mergedWord([
        beforeArguments ? (beforeArguments[index] ?? false) : false,
        afterArguments ? (afterArguments[index] ?? false) : false,
      ]),
    );
    return;
  }
  const length = Math.max(afterArguments.length, beforeArguments.length);
  const merged: ShellWord[] = [];
  for (let index = 0; index < length; index += 1)
    merged.push(
      mergedWord([
        beforeArguments[index] ?? false,
        afterArguments[index] ?? false,
      ]),
    );
  target.positionalArguments = merged;
}

function mergedWord([before, after]: readonly [
  ShellWord | false,
  ShellWord | false,
]): ShellWord {
  return {
    dynamic: true,
    source: `${before ? before.source : ''}|${after ? after.source : ''}`,
    value: `${before ? before.value : ''}|${after ? after.value : ''}`,
  };
}

function mapsEqual([left, right]: readonly [
  ReadonlyMap<string, string>,
  ReadonlyMap<string, string>,
]): boolean {
  return (
    left.size === right.size &&
    [...left].every(([name, value]) => right.get(name) === value)
  );
}

export function shellStdinConsumer(words: readonly ShellWord[]): boolean {
  let index = 0;
  while (['builtin', 'command', 'exec'].includes(words[index]?.value ?? ''))
    index += 1;
  if (!['bash', 'sh'].includes(normalizedRuntime(words[index]?.value ?? '')))
    return false;
  return words.slice(index + 1).every((word) => word.value.startsWith('-'));
}

export function shellRuntimeUsesStdinRedirection(
  words: readonly ShellWord[],
): boolean {
  return words.some((word) => /^0*</u.test(word.source));
}

export function assertSafeShellRuntime([
  request,
  source,
  commandString,
]: readonly [RuntimeCommandRequest, string, boolean]): void {
  if (request.runtime === 'bash' && request.state.environment.has('BASH_ENV'))
    throw new Error('BASH_ENV shell startup hooks are forbidden.');
  if (commandString && /\$(?:\{0\}|0)/u.test(source))
    throw new Error('Shell command-string $0 execution is forbidden.');
}

export function hasArithmeticTestExecution(
  words: readonly ShellWord[],
): boolean {
  const option = words.findIndex((word) => word.value === '-v');
  const operand = words[option + 1];
  return (
    option >= 0 &&
    !!operand &&
    operand.source.includes('$(') &&
    operand.source.includes('[')
  );
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

export function applyParentMutation([command, state, words, start]: readonly [
  string,
  ShellParseState,
  readonly ShellWord[],
  number,
]): boolean {
  if (!['getopts', 'mapfile', 'read', 'readarray'].includes(command))
    return false;
  for (const word of words.slice(start)) {
    if (!/^[A-Za-z_]\w*$/u.test(word.value)) continue;
    const mutation: ShellWord = {
      dynamic: true,
      source: command,
      value: '',
    };
    state.environment.set(word.value, mutation);
  }
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
