import { posix } from 'node:path';
import {
  shellStructure,
  shellSubstitutionBodies,
  type ShellStructureInspection,
} from './skill-provider-shell-structure.ts';
import { tokenizeShell } from './skill-provider-shell-tokenizer.ts';
import {
  aliasInvocationSource,
  applyAliasMutation,
  type AliasRequest,
} from './skill-provider-shell-alias.ts';
import {
  isDispatchWrapper,
  resolveDispatchCommand,
  type DispatchRequest,
} from './skill-provider-shell-dispatch.ts';
import {
  assertBoundedSource,
  assignmentWord,
  consumeAssignments,
  resolveWord,
  staticWord,
} from './skill-provider-shell-environment.ts';
import {
  isAuditedSource,
  type AuditedSourceRequest,
} from './skill-provider-sourced-seams.ts';
import {
  cdOperandIndex,
  normalizedRuntime,
  withoutLeadingRedirections,
} from './skill-provider-shell-command.ts';
import {
  ShellSeparator,
  type EnvPrefixRequest,
  type LaunchRequest,
  type PositionalWordsRequest,
  type RuntimeCommandRequest,
  type RuntimeExecutable,
  type RuntimeExecutableRequest,
  type ShellCommandAnalysis,
  type ShellCommandInspection,
  type ShellCommandRequest,
  type ShellLaunchArgument,
  type ShellParseState,
  type ShellScriptLaunch,
  type ShellWord,
  type WordEnvironmentRequest,
  type WordsEnvironmentRequest,
} from './skill-provider-command-types.ts';

export type {
  ShellCommandAnalysis,
  ShellCommandInspection,
  ShellLaunchArgument,
  ShellScriptLaunch,
} from './skill-provider-command-types.ts';

const MAX_SHELL_COMMANDS = 4_096;
const MAX_SHELL_DEPTH = 8;
const MAX_COMMAND_NORMALIZATIONS = 32;
const PROTECTED_SKILL_PATH =
  /(?:\.agents\/skills|\.cortex\/(?:gizmo|shared|teams\/[^/]+)\/dynamic-skills\/[^/]+\/scripts)\//u;
const PROTECTED_SKILL_FRAGMENTS = [
  '.cortex',
  'dynamic-skills',
  'scripts',
] as const;
const TYPESCRIPT_SCRIPT_REFERENCE =
  /(?:^|[\s"'`:=[({,])((?:\.{0,2}\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.(?:[cm]?[jt]sx?|sh))?)(?=$|[\s"'`,;\]})])/gmu;
const SCRIPT_DIRECTORY_EXPRESSION =
  /^\$\(dirname (?:-- )?["']?(?:\$0|\$\{BASH_SOURCE\[0\]\})["']?\)$/u;
const BUN_BOOLEAN_OPTIONS = new Set(
  '--watch --hot --smol --check --test --version -v --prod'.split(' '),
);
const BUN_VALUE_OPTIONS = new Set(
  '--cwd --preload --conditions --env-file --config --filter --eval -e --print -p'.split(
    ' ',
  ),
);
const BUN_SUBCOMMANDS = new Set(
  'add build create init install link outdated pm publish remove run test unlink update x'.split(
    ' ',
  ),
);
const NODE_BOOLEAN_OPTIONS = new Set('--check --test --version -v'.split(' '));
const NODE_VALUE_OPTIONS = new Set(
  '--conditions --require --import --loader --experimental-loader --env-file --input-type -e --eval --print -p'.split(
    ' ',
  ),
);
const EXECUTABLE_RUNTIME_OPTIONS = new Set(
  '--preload --require --import --loader --experimental-loader --eval -e --print -p'.split(
    ' ',
  ),
);
const TASK_BOOLEAN_OPTIONS = new Set('--list --silent --verbose'.split(' '));
const TASK_VALUE_OPTIONS = new Set('--dir --taskfile -d -t'.split(' '));
const ENV_BOOLEAN_OPTIONS = new Set('-i --ignore-environment'.split(' '));
const ENV_VALUE_OPTIONS = new Set('-u --unset'.split(' '));
const ENV_ATTACHED_VALUE = /^--unset=[^=]+$/u;
type ResolvedCommandRequest = {
  readonly request: RuntimeCommandRequest;
  readonly start: number;
  readonly words: readonly ShellWord[];
};
export function analyzeShellCommands(
  inspection: ShellCommandInspection,
): ShellCommandAnalysis {
  assertBoundedSource(inspection.source);
  const positionalArguments = inspection.positionalArguments
    ? inspection.positionalArguments.map((argument) => ({
        ...argument,
        source: argument.value,
      }))
    : false;
  const state: ShellParseState = {
    aliases: new Map(),
    casePattern: false,
    commandCount: 0,
    cwd: '',
    cwdProtected: false,
    cwdUnknown: false,
    environment: new Map(),
    functions: new Map(),
    launches: [],
    positionalArguments,
    sourcePath: inspection.sourcePath,
  };
  const request: ShellCommandRequest = {
    depth: 0,
    source: inspection.source,
    state,
  };
  analyzeCommandSource(request);
  return { launches: state.launches };
}

export function staticTypeScriptScriptLaunches(
  source: string,
): readonly string[] {
  if (source.includes('{{')) return [];
  TYPESCRIPT_SCRIPT_REFERENCE.lastIndex = 0;
  return [...source.matchAll(TYPESCRIPT_SCRIPT_REFERENCE)]
    .map((match) => match[1] ?? false)
    .filter((specifier): specifier is string => {
      if (specifier === false) return false;
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(
        `(?:^|[\\s;&|"'=:\\[(])(?:bun|node|bash|sh)\\s+["']?${escaped}(?=$|[\\s"';&|])`,
        'u',
      ).test(source);
    });
}

function analyzeCommandSource(request: ShellCommandRequest): void {
  if (request.depth > MAX_SHELL_DEPTH)
    throw new Error('Shell command nesting exceeds its bound.');
  const structureInspection: ShellStructureInspection = {
    functions: request.state.functions,
    source: request.source,
  };
  const structure = shellStructure(structureInspection);
  for (const source of structure.substitutions)
    analyzeSubstitution([request, source]);
  const tokens = tokenizeShell(structure.source);
  let command: ShellWord[] = [];
  let conditionalEnvironment: Map<string, ShellWord> | false = false;
  let pipelineEnvironment: Map<string, ShellWord> | false = false;
  for (const token of [...tokens, ShellSeparator.Newline]) {
    if (request.state.casePattern) {
      if (
        token === ShellSeparator.CloseParenthesis ||
        (typeof token !== 'string' && token.value === 'esac')
      )
        request.state.casePattern = false;
      command = [];
      continue;
    }
    if (
      typeof token !== 'string' ||
      !Object.values(ShellSeparator).includes(token as ShellSeparator)
    ) {
      command.push(token as ShellWord);
      continue;
    }
    if (command.length > 0) {
      if (
        pipelineEnvironment !== false &&
        command.length === 1 &&
        ['bash', 'sh'].includes(normalizedRuntime(command[0]?.value ?? ''))
      )
        throw new Error('Shell pipeline input is forbidden.');
      if (token === ShellSeparator.Pipe && pipelineEnvironment === false)
        pipelineEnvironment = new Map(request.state.environment);
      request.state.commandCount += 1;
      if (request.state.commandCount > MAX_SHELL_COMMANDS)
        throw new Error('Shell command count exceeds its bound.');
      const positionalRequest: PositionalWordsRequest = {
        words: command,
        positionalArguments: request.state.positionalArguments,
      };
      const commandRequest: RuntimeCommandRequest = {
        depth: request.depth,
        runtime: '',
        state: request.state,
        words: expandPositionalWords(positionalRequest),
      };
      analyzeCommand(commandRequest);
      command = [];
      if (pipelineEnvironment !== false) {
        request.state.environment.clear();
        for (const [name, value] of pipelineEnvironment)
          request.state.environment.set(name, value);
        if (token !== ShellSeparator.Pipe) pipelineEnvironment = false;
      }
    }
    if (conditionalEnvironment !== false) {
      request.state.environment.clear();
      for (const [name, value] of conditionalEnvironment)
        request.state.environment.set(name, value);
      conditionalEnvironment = false;
    }
    if (token === ShellSeparator.And || token === ShellSeparator.Or)
      conditionalEnvironment = new Map(request.state.environment);
    if (token === ShellSeparator.CloseParenthesis)
      request.state.casePattern = false;
    if (token === ShellSeparator.Case) request.state.casePattern = true;
  }
}

function analyzeCommand(request: RuntimeCommandRequest): void {
  const words = [...withoutLeadingRedirections(request.words)];
  for (const word of words)
    for (const source of shellSubstitutionBodies(word.source))
      analyzeSubstitution([request, source]);
  const outerEnvironment = request.state.environment;
  const commandEnvironment = new Map(outerEnvironment);
  let index = consumeAssignments([words, 0, commandEnvironment]);
  if (index === words.length) {
    consumeAssignments([words, 0, outerEnvironment]);
    return;
  }
  if (index > 0) {
    const scopedNames = new Set(
      words
        .slice(0, index)
        .map((word) => word.value.split(/\+?=/u, 1)[0] ?? ''),
    );
    if (scopedNames.has('PATH'))
      throw new Error('Command-scoped PATH mutation is forbidden.');
    const scopedState: ShellParseState = {
      ...request.state,
      environment: commandEnvironment,
    };
    const scopedRequest: RuntimeCommandRequest = {
      ...request,
      state: scopedState,
    };
    const resolvedRequest: ResolvedCommandRequest = {
      request: scopedRequest,
      start: index,
      words,
    };
    analyzeResolvedCommand(resolvedRequest);
    for (const [name, value] of commandEnvironment)
      if (!scopedNames.has(name)) outerEnvironment.set(name, value);
    request.state.casePattern = scopedState.casePattern;
    request.state.commandCount = scopedState.commandCount;
    request.state.cwd = scopedState.cwd;
    request.state.cwdProtected = scopedState.cwdProtected;
    request.state.cwdUnknown = scopedState.cwdUnknown;
    request.state.positionalArguments = scopedState.positionalArguments;
    return;
  }
  const resolvedRequest: ResolvedCommandRequest = {
    request,
    start: index,
    words,
  };
  analyzeResolvedCommand(resolvedRequest);
}

function analyzeResolvedCommand(resolved: ResolvedCommandRequest): void {
  const { request, words } = resolved;
  const start = resolved.start;
  let index = start;
  let wordRequest: WordEnvironmentRequest = {
    word: words[index] as ShellWord,
    environment: request.state.environment,
  };
  let command = resolveWord(wordRequest);
  while (
    ['if', 'then', 'else', 'while', 'until', 'do', '!'].includes(command.value)
  ) {
    index += 1;
    if (index === words.length) return;
    wordRequest = {
      word: words[index] as ShellWord,
      environment: request.state.environment,
    };
    command = resolveWord(wordRequest);
  }
  if (command.value === 'case') {
    request.state.casePattern = true;
    return;
  }
  if (
    ['declare', 'export', 'local', 'readonly', 'typeset'].includes(
      command.value,
    )
  ) {
    consumeAssignments([words, index + 1, request.state.environment]);
    return;
  }
  if (/^[<>](?![<>])/u.test(command.value)) return;
  if (/^[A-Za-z_]\w*\+=\(/u.test(command.value)) return;
  if (
    ['for', 'select', 'function', '}', 'fi', 'done', 'esac'].includes(
      command.value,
    )
  )
    return;
  if (command.value === '{') {
    index += 1;
    if (index === words.length) return;
  }
  index = consumeAssignments([words, index, request.state.environment]);
  if (index === words.length) return;
  wordRequest = {
    word: words[index] as ShellWord,
    environment: request.state.environment,
  };
  command = resolveWord(wordRequest);
  const aliasRequest: AliasRequest = {
    command,
    index,
    state: request.state,
    words,
  };
  if (applyAliasMutation(aliasRequest)) return;
  const aliasSource = aliasInvocationSource(aliasRequest);
  if (aliasSource !== false) {
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source: aliasSource,
      state: request.state,
    };
    analyzeCommandSource(nestedRequest);
    return;
  }
  const functionBody = request.state.functions.get(command.value) ?? false;
  if (functionBody !== false) {
    const positionalArguments = request.state.positionalArguments;
    request.state.positionalArguments = words.slice(index + 1).map((word) => {
      const argumentRequest: WordEnvironmentRequest = {
        word,
        environment: request.state.environment,
      };
      return resolveWord(argumentRequest);
    });
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source: functionBody,
      state: request.state,
    };
    try {
      analyzeCommandSource(nestedRequest);
    } finally {
      request.state.positionalArguments = positionalArguments;
    }
    return;
  }
  if (command.value === 'cd') {
    const operandIndex = cdOperandIndex([words, index + 1]);
    if (operandIndex === false) return;
    wordRequest = {
      word: words[operandIndex] as ShellWord,
      environment: request.state.environment,
    };
    const directory = resolveWord(wordRequest);
    if (SCRIPT_DIRECTORY_EXPRESSION.test(directory.value)) return;
    if (directory.dynamic) {
      request.state.cwd = '';
      request.state.cwdProtected = wordHasProtectedMarkers(directory);
      request.state.cwdUnknown = !request.state.cwdProtected;
      return;
    }
    request.state.cwdProtected = false;
    request.state.cwdUnknown = false;
    request.state.cwd = posix.normalize(
      posix.join(request.state.cwd, directory.value),
    );
    return;
  }
  if (command.dynamic) {
    if (
      (command.value === '$@' || command.value === '${@}') &&
      request.state.positionalArguments === false
    )
      throw new Error('Unbound shell positional delegation is forbidden.');
    const dynamicArguments = words.slice(index + 1).map((word) => {
      const resolutionRequest: WordEnvironmentRequest = {
        word,
        environment: request.state.environment,
      };
      return resolveWord(resolutionRequest);
    });
    if (
      wordHasProtectedMarkers(command) ||
      dynamicArguments.some(wordHasProtectedMarkers)
    )
      throw new Error(
        `Dynamic protected-skill command construction is forbidden: ${command.source}`,
      );
    if (command.source.includes('{{')) return;
    throw new Error(
      `Unknown dynamic executable is forbidden: ${command.source}`,
    );
  }
  index += 1;
  command = { ...command, value: normalizedRuntime(command.value) };
  if (command.value === 'eval') {
    analyzeEval([request, words, index]);
    return;
  }
  if (command.value === 'shift') {
    wordRequest = {
      word: words[index] as ShellWord,
      environment: request.state.environment,
    };
    const amountWord = words[index]
      ? resolveWord(wordRequest)
      : staticWord('1');
    const amount = Number.parseInt(amountWord.value, 10);
    if (amountWord.dynamic || !Number.isSafeInteger(amount) || amount < 0)
      throw new Error('Dynamic shell positional mutation is forbidden.');
    request.state.positionalArguments = request.state.positionalArguments
      ? request.state.positionalArguments.slice(amount)
      : false;
    return;
  }
  if (
    ['command', 'exec'].includes(command.value) &&
    request.state.positionalArguments === false &&
    ['$@', '${@}'].includes(words[index]?.value ?? '')
  )
    throw new Error('Unbound shell positional delegation is forbidden.');
  let normalized = false;
  const outerDispatchEnvironment = request.state.environment;
  let dispatchEnvironment = outerDispatchEnvironment;
  for (let step = 0; step < MAX_COMMAND_NORMALIZATIONS; step += 1) {
    if (isDispatchWrapper(command.value)) {
      dispatchEnvironment = new Map(dispatchEnvironment);
      const dispatchRequest: DispatchRequest = {
        command,
        environment: dispatchEnvironment,
        index,
        words,
      };
      const dispatch = resolveDispatchCommand(dispatchRequest);
      if (dispatch === false) return;
      ({ command, index } = dispatch);
      continue;
    }
    if (command.value === 'env') {
      dispatchEnvironment = new Map(dispatchEnvironment);
      const envRequest: EnvPrefixRequest = {
        words,
        start: index,
        environment: dispatchEnvironment,
      };
      index = consumeEnvPrefix(envRequest);
      if (index === words.length) return;
      wordRequest = {
        word: words[index] as ShellWord,
        environment: dispatchEnvironment,
      };
      command = resolveWord(wordRequest);
      if (command.dynamic) {
        const argumentsRequest: WordsEnvironmentRequest = {
          words: words.slice(index + 1),
          environment: dispatchEnvironment,
        };
        if (argumentsContainProtectedPath(argumentsRequest))
          throw new Error(
            'Dynamic protected-skill command construction is forbidden.',
          );
        throw new Error('Unknown dynamic executable is forbidden.');
      }
      index += 1;
      continue;
    }
    normalized = true;
    break;
  }
  if (!normalized)
    throw new Error('Shell command normalization exceeds its bound.');
  if (
    ['alias', 'eval', 'unalias'].includes(command.value) ||
    request.state.aliases.has(command.value)
  ) {
    const normalizedRequest: RuntimeCommandRequest = {
      ...request,
      depth: request.depth + 1,
      state:
        dispatchEnvironment === outerDispatchEnvironment
          ? request.state
          : { ...request.state, environment: dispatchEnvironment },
      words: [command, ...words.slice(index)],
    };
    analyzeCommand(normalizedRequest);
    return;
  }
  const commandRequest: RuntimeCommandRequest = {
    ...request,
    runtime: command.value,
    state:
      dispatchEnvironment === outerDispatchEnvironment
        ? request.state
        : { ...request.state, environment: dispatchEnvironment },
    words: words.slice(index).map((word) => {
      const resolutionRequest: WordEnvironmentRequest = {
        word,
        environment: request.state.environment,
      };
      return resolveWord(resolutionRequest);
    }),
  };
  analyzeRuntime(commandRequest);
}

function analyzeEval([request, words, start]: readonly [
  RuntimeCommandRequest,
  readonly ShellWord[],
  number,
]): void {
  const values = words.slice(start).map((word) => {
    const valueRequest: WordEnvironmentRequest = {
      environment: request.state.environment,
      word,
    };
    return resolveWord(valueRequest);
  });
  if (values.some((word) => word.dynamic))
    throw new Error('Dynamic shell eval is forbidden.');
  const source = (values[0]?.value === '--' ? values.slice(1) : values)
    .map((word) => word.value)
    .join(' ');
  const nestedRequest: ShellCommandRequest = {
    depth: request.depth + 1,
    source,
    state: request.state,
  };
  analyzeCommandSource(nestedRequest);
}

function analyzeSubstitution([request, source]: readonly [
  Pick<ShellCommandRequest, 'depth' | 'state'>,
  string,
]): void {
  const nestedState: ShellParseState = {
    ...request.state,
    aliases: new Map(request.state.aliases),
    environment: new Map(request.state.environment),
    functions: new Map(request.state.functions),
  };
  const nestedRequest: ShellCommandRequest = {
    depth: request.depth + 1,
    source,
    state: nestedState,
  };
  analyzeCommandSource(nestedRequest);
  request.state.commandCount = nestedState.commandCount;
}

function argumentsContainProtectedPath(
  request: WordsEnvironmentRequest,
): boolean {
  return request.words
    .map((word) => {
      const resolutionRequest: WordEnvironmentRequest = {
        word,
        environment: request.environment,
      };
      return resolveWord(resolutionRequest);
    })
    .some(wordCouldReachProtected);
}

function wordCouldReachProtected(word: ShellWord): boolean {
  return word.dynamic || wordHasProtectedMarkers(word);
}

function wordHasProtectedMarkers(word: ShellWord): boolean {
  return (
    PROTECTED_SKILL_PATH.test(word.value) ||
    PROTECTED_SKILL_PATH.test(word.source) ||
    PROTECTED_SKILL_FRAGMENTS.every(
      (fragment) =>
        word.value.includes(fragment) || word.source.includes(fragment),
    )
  );
}

function consumeEnvPrefix(request: EnvPrefixRequest): number {
  let index = request.start;
  let options = true;
  while (index < request.words.length) {
    const assignmentRequest: WordEnvironmentRequest = {
      word: request.words[index] as ShellWord,
      environment: request.environment,
    };
    const assignment = assignmentWord(assignmentRequest);
    if (assignment !== false) {
      if (assignment.name === 'PATH')
        throw new Error('env PATH mutation is forbidden.');
      request.environment.set(assignment.name, assignment.value);
      index += 1;
      continue;
    }
    let wordRequest: WordEnvironmentRequest = {
      word: request.words[index] as ShellWord,
      environment: request.environment,
    };
    const word = resolveWord(wordRequest);
    if (word.dynamic)
      throw new Error('Dynamic env command construction is forbidden.');
    if (options && word.value === '--') {
      options = false;
      index += 1;
      continue;
    }
    if (options && ENV_BOOLEAN_OPTIONS.has(word.value)) {
      index += 1;
      continue;
    }
    if (options && ENV_VALUE_OPTIONS.has(word.value)) {
      if (!request.words[index + 1])
        throw new Error('Missing env option value.');
      wordRequest = {
        word: request.words[index + 1] as ShellWord,
        environment: request.environment,
      };
      const value = resolveWord(wordRequest);
      if (value.dynamic)
        throw new Error('Dynamic env option value is forbidden.');
      index += 2;
      continue;
    }
    if (options && ENV_ATTACHED_VALUE.test(word.value)) {
      index += 1;
      continue;
    }
    if (options && word.value.startsWith('-'))
      throw new Error(`Unsupported env option: ${word.value}`);
    break;
  }
  return index;
}

function analyzeRuntime(request: RuntimeCommandRequest): void {
  if (request.runtime === 'bun' || request.runtime === 'node') {
    const executableRequest: RuntimeExecutableRequest = {
      booleanOptions:
        request.runtime === 'bun' ? BUN_BOOLEAN_OPTIONS : NODE_BOOLEAN_OPTIONS,
      runtime: request.runtime,
      valueOptions:
        request.runtime === 'bun' ? BUN_VALUE_OPTIONS : NODE_VALUE_OPTIONS,
      words: request.words,
    };
    const executables = runtimeExecutable(executableRequest);
    if (executables === false) return;
    for (const launch of executables) {
      const launchRequest: LaunchRequest = { launch, state: request.state };
      addLaunch(launchRequest);
    }
    return;
  }
  if (request.runtime === 'task' || request.runtime === 'go-task') {
    const executableRequest: RuntimeExecutableRequest = {
      booleanOptions: TASK_BOOLEAN_OPTIONS,
      runtime: request.runtime,
      valueOptions: TASK_VALUE_OPTIONS,
      words: request.words,
    };
    runtimeExecutable(executableRequest);
    return;
  }
  if (request.runtime === 'bash' || request.runtime === 'sh') {
    analyzeShellRuntime(request);
    return;
  }
  if (request.runtime === 'npm' && request.words[0]?.value === 'exec') {
    const option = request.words[1];
    const source =
      option?.value === '-c' || option?.value === '--call'
        ? request.words[2]
        : option?.value.startsWith('--call=')
          ? staticWord(option.value.slice('--call='.length))
          : false;
    if (!source) return;
    if (source.dynamic)
      throw new Error('Dynamic npm exec command is forbidden.');
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source: source.value,
      state: request.state,
    };
    analyzeCommandSource(nestedRequest);
    return;
  }
  if (request.runtime === 'trap') {
    const action = request.words[0];
    if (!action || action.value === '-' || action.value.startsWith('-')) return;
    if (action.dynamic) throw new Error('Dynamic shell trap is forbidden.');
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source: action.value,
      state: request.state,
    };
    analyzeCommandSource(nestedRequest);
    return;
  }
  if (request.runtime === 'source' || request.runtime === '.') {
    const executable = request.words[0];
    if (request.runtime === '.' && !executable) return;
    const sourceRequest: AuditedSourceRequest = {
      source: executable?.source ?? '',
      sourcePath: request.state.sourcePath,
    };
    if (
      executable &&
      request.words.length === 1 &&
      isAuditedSource(sourceRequest)
    )
      return;
    throw new Error(
      `Unsupported sourced shell execution in ${request.state.sourcePath || 'inline'}: ${executable?.source ?? 'missing'}`,
    );
  }
  const directExecutable = staticWord(request.runtime);
  if (looksLikeRepositoryScript(directExecutable.value)) {
    const launch: RuntimeExecutable = {
      executable: directExecutable,
      arguments: request.words,
    };
    const launchRequest: LaunchRequest = { launch, state: request.state };
    addLaunch(launchRequest);
  }
}

function analyzeShellRuntime(request: RuntimeCommandRequest): void {
  let index = 0;
  let commandString = false;
  while (index < request.words.length) {
    const word = request.words[index] as ShellWord;
    if (!word.value.startsWith('-') || word.value === '-') break;
    if (word.dynamic) {
      const argumentsRequest: WordsEnvironmentRequest = {
        words: request.words.slice(index),
        environment: request.state.environment,
      };
      if (argumentsContainProtectedPath(argumentsRequest))
        throw new Error(
          'Dynamic protected-skill shell option construction is forbidden.',
        );
      return;
    }
    if (word.value === '--') {
      index += 1;
      break;
    }
    if (!/^-+[abefhkmnptuvxBCEHPT]*c?[abefhkmnptuvxBCEHPT]*$/u.test(word.value))
      throw new Error(`Unsupported shell runtime option: ${word.value}`);
    if (word.value.includes('c')) commandString = true;
    index += 1;
  }
  const executable = request.words[index];
  if (!executable) return;
  if (/^[<>]\(/u.test(executable.source))
    throw new Error('Shell process-substitution input is forbidden.');
  if (!executableIsStatic(executable)) return;
  if (commandString) {
    const positionalArguments = request.state.positionalArguments;
    request.state.positionalArguments = request.words.slice(index + 2);
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source: executable.value,
      state: request.state,
    };
    try {
      analyzeCommandSource(nestedRequest);
    } finally {
      request.state.positionalArguments = positionalArguments;
    }
    return;
  }
  const launch: RuntimeExecutable = {
    executable,
    arguments: request.words.slice(index + 1),
  };
  const launchRequest: LaunchRequest = { launch, state: request.state };
  addLaunch(launchRequest);
}

function runtimeExecutable(
  request: RuntimeExecutableRequest,
): readonly RuntimeExecutable[] | false {
  let index = 0;
  let terminated = false;
  while (index < request.words.length) {
    const word = request.words[index] as ShellWord;
    if (word.value === '--') {
      terminated = true;
      index += 1;
      break;
    }
    if (!word.value.startsWith('-') || word.value === '-') break;
    if (word.dynamic) {
      if (
        request.words
          .slice(index)
          .some((candidate) => PROTECTED_SKILL_PATH.test(candidate.value))
      )
        throw new Error(
          'Dynamic protected-skill runtime option construction is forbidden.',
        );
      return false;
    }
    const option = word.value.split('=')[0] ?? '';
    if (EXECUTABLE_RUNTIME_OPTIONS.has(option))
      throw new Error(
        `Executable ${request.runtime} runtime option is forbidden.`,
      );
    if (request.booleanOptions.has(word.value)) {
      index += 1;
      continue;
    }
    if (!request.valueOptions.has(option))
      throw new Error(
        `Unsupported ${request.runtime} runtime option: ${word.value}`,
      );
    if (!word.value.includes('=')) {
      const value = request.words[index + 1];
      if (!value) throw new Error('Missing runtime option value.');
      if (value.dynamic) {
        if (
          request.words
            .slice(index + 1)
            .some((candidate) => PROTECTED_SKILL_PATH.test(candidate.value))
        )
          throw new Error(
            'Dynamic protected-skill runtime option value is forbidden.',
          );
        return false;
      }
      index += 1;
    }
    index += 1;
  }
  if (index === request.words.length) return false;
  const executable = request.words[index] as ShellWord;
  if (!executableIsStatic(executable)) {
    if (
      executable.source.includes('{{') &&
      !wordHasProtectedMarkers(executable)
    )
      return false;
    if (
      (request.runtime === 'task' || request.runtime === 'go-task') &&
      /^\{\{\.[A-Za-z_]\w*\}\}$/u.test(executable.source)
    )
      return false;
    throw new Error(
      `Dynamic ${request.runtime} executable construction is forbidden: ${executable.source}`,
    );
  }
  if (
    !terminated &&
    request.runtime === 'bun' &&
    BUN_SUBCOMMANDS.has(executable.value)
  ) {
    const taskName = request.words[index + 1];
    if (!taskName) return false;
    if (!executableIsStatic(taskName)) return false;
    if (executable.value === 'test')
      return request.words
        .slice(index + 1)
        .filter((word) => !word.value.startsWith('-'))
        .filter((word) => looksLikeRepositoryScript(word.value))
        .map((word) => ({ executable: word, arguments: [] }));
    if (executable.value === 'run' && looksLikeRepositoryScript(taskName.value))
      return [
        { executable: taskName, arguments: request.words.slice(index + 2) },
      ];
    return false;
  }
  return [{ executable, arguments: request.words.slice(index + 1) }];
}

function executableIsStatic(word: ShellWord): boolean {
  if (/^'[\s\S]*'$/u.test(word.source)) return true;
  if (!/^['"]/u.test(word.source) && /[{}]/u.test(word.value))
    throw new Error('Shell brace expansion in an executable is forbidden.');
  if (!word.dynamic) return true;
  if (
    PROTECTED_SKILL_PATH.test(word.value) ||
    PROTECTED_SKILL_PATH.test(word.source) ||
    PROTECTED_SKILL_FRAGMENTS.every((fragment) => word.value.includes(fragment))
  )
    throw new Error(
      'Dynamic protected-skill executable construction is forbidden.',
    );
  return false;
}

function addLaunch(request: LaunchRequest): void {
  const value =
    request.state.cwd.length > 0
      ? posix.normalize(
          posix.join(request.state.cwd, request.launch.executable.value),
        )
      : request.launch.executable.value;
  if (!looksLikeRepositoryScript(value)) return;
  if (request.state.cwdProtected)
    throw new Error('Dynamic protected-skill working directory is forbidden.');
  if (request.state.cwdUnknown)
    throw new Error(
      `Unknown dynamic working directory is forbidden for ${request.launch.executable.source}.`,
    );
  const positionalArguments = request.launch.arguments.map((word) => ({
    dynamic: word.dynamic,
    value: word.value,
  }));
  const scriptLaunch: ShellScriptLaunch = {
    specifier: value,
    positionalArguments,
  };
  request.state.launches.push(scriptLaunch);
}

function looksLikeRepositoryScript(value: string): boolean {
  if (value.includes('*') || value.includes('?') || value.includes('['))
    return PROTECTED_SKILL_PATH.test(value);
  if (/^(?:build|coverage|dist|target)\//u.test(value)) return false;
  return (
    !/^(?:[a-z]+:|\/)/u.test(value) &&
    !value.includes('node_modules/.bin/') &&
    /[/.]/u.test(value)
  );
}

function expandPositionalWords(
  request: PositionalWordsRequest,
): readonly ShellWord[] {
  const expanded: ShellWord[] = [];
  for (const word of request.words) {
    if (word.value === '$@' || word.value === '${@}') {
      if (request.positionalArguments === false) expanded.push(word);
      else expanded.push(...request.positionalArguments);
    } else if (request.positionalArguments !== false) {
      let value = '';
      let dynamic = word.dynamic;
      let end = 0;
      for (const match of word.value.matchAll(
        /\$(?:\{([1-9]\d*)\}|([1-9]\d*))/gu,
      )) {
        const argument =
          request.positionalArguments[Number(match[1] ?? match[2]) - 1];
        value += word.value.slice(end, match.index);
        if (argument) {
          value += argument.value;
          dynamic ||= argument.dynamic;
        } else {
          value += match[0];
          dynamic = true;
        }
        end = match.index + match[0].length;
      }
      const expandedWord: ShellWord = {
        ...word,
        value: value + word.value.slice(end),
        dynamic,
      };
      expanded.push(expandedWord);
    } else expanded.push(word);
  }
  return expanded;
}
