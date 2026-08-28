import {
  assignmentWord,
  resolveWord,
} from './skill-provider-shell-environment.ts';
import type {
  ShellEnvironment,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

export type DispatchRequest = {
  readonly command: ShellWord;
  readonly environment: ShellEnvironment;
  readonly index: number;
  readonly words: readonly ShellWord[];
};
export type DispatchResult = {
  readonly command: ShellWord;
  readonly index: number;
};

const WRAPPERS = new Set(
  'builtin command exec nohup sudo time xargs'.split(' '),
);
const SUDO_BOOLEAN = new Set('-n -E -H -S -k -K -v --'.split(' '));
const SUDO_VALUE = new Set('-u -g -h -p -C -T'.split(' '));
const XARGS_BOOLEAN = new Set('-0 --null -r --no-run-if-empty --'.split(' '));
const XARGS_VALUE = new Set('-I -n -P -s -a -E'.split(' '));

export function resolveDispatchCommand(
  request: DispatchRequest,
): DispatchResult | false {
  let command = request.command;
  let index = request.index;
  while (WRAPPERS.has(command.value)) {
    const wrapper = command.value;
    if (wrapper === 'builtin') {
      const option = resolveAt([request, index]);
      if (option !== false && option.value === '--') index += 1;
      else if (option !== false && option.value.startsWith('-')) return false;
    } else if (wrapper === 'command') {
      const option = resolveAt([request, index]);
      if (option !== false && (option.value === '-v' || option.value === '-V'))
        return false;
      if (option !== false && (option.value === '-p' || option.value === '--'))
        index += 1;
      else assertNoOption([option, wrapper]);
    } else if (wrapper === 'exec') {
      while (true) {
        const option = resolveAt([request, index]);
        if (!option || !option.value.startsWith('-')) break;
        if (
          option.value === '--' ||
          option.value === '-c' ||
          option.value === '-l'
        )
          index += 1;
        else if (option.value === '-a') index = consumeValue([request, index]);
        else throw new Error(`Unsupported exec option: ${option.value}`);
      }
    } else if (wrapper === 'nohup') {
      const option = resolveAt([request, index]);
      if (option !== false && option.value === '--') index += 1;
      else if (
        option !== false &&
        (option.value === '--help' || option.value === '--version')
      )
        return false;
      else assertNoOption([option, wrapper]);
    } else if (wrapper === 'time') {
      const option = resolveAt([request, index]);
      if (option !== false && (option.value === '-p' || option.value === '--'))
        index += 1;
      else assertNoOption([option, wrapper]);
    } else if (wrapper === 'sudo')
      index = consumeOptions([
        request,
        index,
        SUDO_BOOLEAN,
        SUDO_VALUE,
        wrapper,
      ]);
    else
      index = consumeOptions([
        request,
        index,
        XARGS_BOOLEAN,
        XARGS_VALUE,
        wrapper,
      ]);
    index = consumeAssignments([request, index]);
    const next = resolveAt([request, index]);
    if (!next) return false;
    if (next.dynamic)
      throw new Error(`Dynamic ${wrapper} executable is forbidden.`);
    command = next;
    index += 1;
  }
  return { command, index };
}

function consumeAssignments([request, start]: readonly [
  DispatchRequest,
  number,
]): number {
  let index = start;
  for (; index < request.words.length; index += 1) {
    const assignmentRequest: WordEnvironmentRequest = {
      environment: request.environment,
      word: request.words[index] as ShellWord,
    };
    const assignment = assignmentWord(assignmentRequest);
    if (assignment === false) break;
    request.environment.set(assignment.name, assignment.value);
  }
  return index;
}

function consumeOptions([request, start, booleans, values, wrapper]: readonly [
  DispatchRequest,
  number,
  ReadonlySet<string>,
  ReadonlySet<string>,
  string,
]): number {
  let index = start;
  while (true) {
    const option = resolveAt([request, index]);
    if (!option || !option.value.startsWith('-')) return index;
    if (option.dynamic)
      throw new Error(`Dynamic ${wrapper} option is forbidden.`);
    if (booleans.has(option.value)) index += 1;
    else if (values.has(option.value)) index = consumeValue([request, index]);
    else if (wrapper === 'xargs' && /^-(?:I|n|P|s|a|E).+/u.test(option.value))
      index += 1;
    else throw new Error(`Unsupported ${wrapper} option: ${option.value}`);
  }
}

function consumeValue([request, index]: readonly [
  DispatchRequest,
  number,
]): number {
  const value = resolveAt([request, index + 1]);
  if (!value || value.dynamic)
    throw new Error('Missing or dynamic dispatch option value.');
  return index + 2;
}

function resolveAt([request, index]: readonly [DispatchRequest, number]):
  ShellWord | false {
  const word = request.words[index];
  if (!word) return false;
  const resolutionRequest: WordEnvironmentRequest = {
    environment: request.environment,
    word,
  };
  return resolveWord(resolutionRequest);
}

function assertNoOption([option, wrapper]: readonly [
  ShellWord | false,
  string,
]): void {
  if (option && option.value.startsWith('-'))
    throw new Error(`Unsupported ${wrapper} option: ${option.value}`);
}
