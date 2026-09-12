import { ShellRuntimeInvocation } from './skill-provider-shell-runtime.ts';
import { posix } from 'node:path';

import {
  type ShellStructureInspection,
  SkillProviderShellStructureScenario,
} from './skill-provider-shell-structure.ts';

import { SkillProviderShellTokenizerScenario } from './skill-provider-shell-tokenizer.ts';

import {
  type AliasRequest,
  SkillProviderShellAliasScenario,
} from './skill-provider-shell-alias.ts';

import {
  type DispatchRequest,
  SkillProviderShellDispatchScenario,
} from './skill-provider-shell-dispatch.ts';

import { SkillProviderShellEnvironmentScenario } from './skill-provider-shell-environment.ts';

import {
  PROTECTED_SKILL_PATH,
  SkillProviderShellCommandScenario,
} from './skill-provider-shell-command.ts';

import {
  ShellSeparator,
  type EnvPrefixRequest,
  type LaunchRequest,
  type PositionalWordsRequest,
  type RuntimeCommandRequest,
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

export class SkillProviderCommandBoundaryScenario {
  private constructor(private readonly request: ShellCommandRequest) {}

  static analyzeShellCommands(
    inspection: ShellCommandInspection,
  ): ShellCommandAnalysis {
    SkillProviderShellEnvironmentScenario.assertBoundedSource(
      inspection.source,
    );
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
    SkillProviderCommandBoundaryScenario.analyzeCommandSource(request);
    return { launches: state.launches };
  }

  static staticTypeScriptScriptLaunches(source: string): readonly string[] {
    if (source.includes('{{')) return [];
    TYPESCRIPT_SCRIPT_REFERENCE.lastIndex = 0;
    return [...source.matchAll(TYPESCRIPT_SCRIPT_REFERENCE)]
      .map((match) => {
        const [, specifier = false] = match;
        return specifier;
      })
      .filter((specifier): specifier is string => {
        if (specifier === false) return false;
        const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return new RegExp(
          `(?:^|[\\s;&|"'=:\\[(])(?:bun|node|bash|sh)\\s+["']?${escaped}(?=$|[\\s"';&|])`,
          'u',
        ).test(source);
      });
  }

  static analyzeCommandSource(request: ShellCommandRequest): void {
    return new SkillProviderCommandBoundaryScenario(request).execute();
  }

  private execute(): void {
    const request = this.request;
    if (request.depth > MAX_SHELL_DEPTH)
      throw new Error('Shell command nesting exceeds its bound.');
    const structureInspection: ShellStructureInspection = {
      functions: request.state.functions,
      source: request.source,
    };
    const structure =
      SkillProviderShellStructureScenario.shellStructure(structureInspection);
    for (const source of structure.substitutions)
      SkillProviderCommandBoundaryScenario.analyzeSubstitution([
        request,
        source,
      ]);
    const tokens = SkillProviderShellTokenizerScenario.tokenizeShell(
      structure.source,
    );
    let command: ShellWord[] = [];
    let conditionalState: ShellParseState | false = false;
    let pipelineState: ShellParseState | false = false;
    const subshells: ShellParseState[] = [];
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
          pipelineState !== false &&
          SkillProviderShellCommandScenario.shellStdinConsumer(command)
        )
          throw new Error('Shell pipeline input is forbidden.');
        if (token === ShellSeparator.Pipe && pipelineState === false)
          pipelineState = SkillProviderShellCommandScenario.isolatedShellState(
            request.state,
          );
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
          words:
            SkillProviderCommandBoundaryScenario.expandPositionalWords(
              positionalRequest,
            ),
        };
        SkillProviderCommandBoundaryScenario.analyzeCommand(commandRequest);
        command = [];
        if (pipelineState !== false) {
          SkillProviderShellCommandScenario.restoreShellState([
            request.state,
            pipelineState,
          ]);
          if (token !== ShellSeparator.Pipe) pipelineState = false;
        }
      }
      if (conditionalState !== false) {
        SkillProviderShellCommandScenario.mergeConditionalShellState([
          request.state,
          conditionalState,
        ]);
        conditionalState = false;
      }
      if (token === ShellSeparator.And || token === ShellSeparator.Or)
        conditionalState = SkillProviderShellCommandScenario.isolatedShellState(
          request.state,
        );
      if (token === ShellSeparator.OpenParenthesis)
        subshells.push(
          SkillProviderShellCommandScenario.isolatedShellState(request.state),
        );
      if (token === ShellSeparator.CloseParenthesis) {
        const snapshot = subshells.pop();
        if (snapshot)
          SkillProviderShellCommandScenario.restoreShellState([
            request.state,
            snapshot,
          ]);
      }
      if (token === ShellSeparator.CloseParenthesis)
        request.state.casePattern = false;
      if (token === ShellSeparator.Case) request.state.casePattern = true;
    }
  }

  static analyzeCommand(request: RuntimeCommandRequest): void {
    const words = [
      ...SkillProviderShellCommandScenario.withoutLeadingRedirections(
        request.words,
      ),
    ];
    if (
      SkillProviderShellCommandScenario.hasLeadingStdinRedirection(
        request.words,
      ) &&
      SkillProviderShellCommandScenario.shellStdinConsumer(words)
    )
      throw new Error('Shell runtime stdin redirection is forbidden.');
    for (const word of words)
      for (const source of SkillProviderShellStructureScenario.shellSubstitutionBodies(
        word.source,
      ))
        SkillProviderCommandBoundaryScenario.analyzeSubstitution([
          request,
          source,
        ]);
    const outerEnvironment = request.state.environment;
    const commandEnvironment = new Map(outerEnvironment);
    let index = SkillProviderShellEnvironmentScenario.consumeAssignments([
      words,
      0,
      commandEnvironment,
    ]);
    if (index === words.length) {
      SkillProviderShellEnvironmentScenario.consumeAssignments([
        words,
        0,
        outerEnvironment,
      ]);
      return;
    }
    if (index > 0) {
      const scopedNames = new Set(
        words.slice(0, index).map((word) => {
          const [name = ''] = word.value.split(/\+?=/u, 1);
          return name;
        }),
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
      SkillProviderCommandBoundaryScenario.analyzeResolvedCommand(
        resolvedRequest,
      );
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
    SkillProviderCommandBoundaryScenario.analyzeResolvedCommand(
      resolvedRequest,
    );
  }

  static analyzeResolvedCommand(resolved: ResolvedCommandRequest): void {
    const { request, words } = resolved;
    const start = resolved.start;
    let index = start;
    let wordRequest: WordEnvironmentRequest = {
      word: words[index] as ShellWord,
      environment: request.state.environment,
    };
    let command =
      SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
    while (
      ['if', 'then', 'else', 'while', 'until', 'do', '!'].includes(
        command.value,
      )
    ) {
      index += 1;
      if (index === words.length) return;
      wordRequest = {
        word: words[index] as ShellWord,
        environment: request.state.environment,
      };
      command = SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
    }
    if (command.value === 'coproc')
      throw new Error('Shell coprocess execution is forbidden.');
    if (command.value === 'case') {
      request.state.casePattern = true;
      return;
    }
    if (
      ['declare', 'export', 'local', 'readonly', 'typeset'].includes(
        command.value,
      )
    ) {
      SkillProviderShellEnvironmentScenario.consumeAssignments([
        words,
        index + 1,
        request.state.environment,
      ]);
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
    index = SkillProviderShellEnvironmentScenario.consumeAssignments([
      words,
      index,
      request.state.environment,
    ]);
    if (index === words.length) return;
    wordRequest = {
      word: words[index] as ShellWord,
      environment: request.state.environment,
    };
    command = SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
    const aliasRequest: AliasRequest = {
      command,
      index,
      state: request.state,
      words,
    };
    if (SkillProviderShellAliasScenario.applyAliasMutation(aliasRequest))
      return;
    const aliasSource =
      SkillProviderShellAliasScenario.aliasInvocationSource(aliasRequest);
    if (aliasSource !== false) {
      const nestedRequest: ShellCommandRequest = {
        depth: request.depth + 1,
        source: aliasSource,
        state: request.state,
      };
      SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
      return;
    }
    const [functionBody = false] = [request.state.functions.get(command.value)];
    if (functionBody !== false) {
      const positionalArguments = request.state.positionalArguments;
      request.state.positionalArguments = words.slice(index + 1).map((word) => {
        const argumentRequest: WordEnvironmentRequest = {
          word,
          environment: request.state.environment,
        };
        return SkillProviderShellEnvironmentScenario.resolveWord(
          argumentRequest,
        );
      });
      const nestedRequest: ShellCommandRequest = {
        depth: request.depth + 1,
        source: functionBody,
        state: request.state,
      };
      try {
        SkillProviderCommandBoundaryScenario.analyzeCommandSource(
          nestedRequest,
        );
      } finally {
        request.state.positionalArguments = positionalArguments;
      }
      return;
    }
    if (command.value === 'cd') {
      SkillProviderShellCommandScenario.applyCd([
        request.state,
        words,
        index + 1,
      ]);
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
        return SkillProviderShellEnvironmentScenario.resolveWord(
          resolutionRequest,
        );
      });
      if (
        SkillProviderCommandBoundaryScenario.wordHasProtectedMarkers(command) ||
        dynamicArguments.some(
          SkillProviderCommandBoundaryScenario.wordHasProtectedMarkers,
        )
      )
        throw new Error(
          `Dynamic protected-skill command construction is forbidden: ${command.source}`,
        );
      throw new Error(
        `Unknown dynamic executable is forbidden in ${request.state.sourcePath || 'inline'}: ${command.source}`,
      );
    }
    index += 1;
    command = {
      ...command,
      value: SkillProviderShellCommandScenario.normalizedRuntime(command.value),
    };
    if (command.value === 'eval') {
      SkillProviderCommandBoundaryScenario.analyzeEval([request, words, index]);
      return;
    }
    if (command.value === 'shift') {
      wordRequest = {
        word: words[index] as ShellWord,
        environment: request.state.environment,
      };
      const amountWord = words[index]
        ? SkillProviderShellEnvironmentScenario.resolveWord(wordRequest)
        : SkillProviderShellEnvironmentScenario.staticWord('1');
      const amount = Number.parseInt(amountWord.value, 10);
      if (amountWord.dynamic || !Number.isSafeInteger(amount) || amount < 0)
        throw new Error('Dynamic shell positional mutation is forbidden.');
      request.state.positionalArguments = request.state.positionalArguments
        ? request.state.positionalArguments.slice(amount)
        : false;
      return;
    }
    if (
      command.value === 'set' &&
      SkillProviderShellCommandScenario.applySetPositional([
        request.state,
        words,
        index,
      ])
    )
      return;
    if (
      SkillProviderShellCommandScenario.applyParentMutation([
        command.value,
        request.state,
        words,
        index,
      ])
    )
      return;
    const [defaulted3 = ''] = [words[index]?.value];
    if (
      ['command', 'exec'].includes(command.value) &&
      request.state.positionalArguments === false &&
      ['$@', '${@}'].includes(defaulted3)
    )
      throw new Error('Unbound shell positional delegation is forbidden.');
    let normalized = false;
    const outerDispatchEnvironment = request.state.environment;
    let dispatchEnvironment = outerDispatchEnvironment;
    for (let step = 0; step < MAX_COMMAND_NORMALIZATIONS; step += 1) {
      if (SkillProviderShellDispatchScenario.isDispatchWrapper(command.value)) {
        dispatchEnvironment = new Map(dispatchEnvironment);
        const dispatchRequest: DispatchRequest = {
          command,
          environment: dispatchEnvironment,
          index,
          words,
        };
        const dispatch =
          SkillProviderShellDispatchScenario.resolveDispatchCommand(
            dispatchRequest,
          );
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
        index = ShellRuntimeInvocation.consumeEnvPrefix(envRequest);
        if (index === words.length) return;
        wordRequest = {
          word: words[index] as ShellWord,
          environment: dispatchEnvironment,
        };
        command =
          SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
        if (command.dynamic) {
          const argumentsRequest: WordsEnvironmentRequest = {
            words: words.slice(index + 1),
            environment: dispatchEnvironment,
          };
          if (
            SkillProviderCommandBoundaryScenario.argumentsContainProtectedPath(
              argumentsRequest,
            )
          )
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
      ['alias', 'cd', 'eval', 'unalias'].includes(command.value) ||
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
      SkillProviderCommandBoundaryScenario.analyzeCommand(normalizedRequest);
      request.state.cwd = normalizedRequest.state.cwd;
      request.state.cwdProtected = normalizedRequest.state.cwdProtected;
      request.state.cwdUnknown = normalizedRequest.state.cwdUnknown;
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
          environment: dispatchEnvironment,
        };
        return SkillProviderShellEnvironmentScenario.resolveWord(
          resolutionRequest,
        );
      }),
    };
    ShellRuntimeInvocation.analyzeRuntime(commandRequest);
  }

  static analyzeEval([request, words, start]: readonly [
    RuntimeCommandRequest,
    readonly ShellWord[],
    number,
  ]): void {
    const values = words.slice(start).map((word) => {
      const valueRequest: WordEnvironmentRequest = {
        environment: request.state.environment,
        word,
      };
      return SkillProviderShellEnvironmentScenario.resolveWord(valueRequest);
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
    SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
  }

  static analyzeSubstitution([request, source]: readonly [
    Pick<ShellCommandRequest, 'depth' | 'state'>,
    string,
  ]): void {
    const nestedState = SkillProviderShellCommandScenario.isolatedShellState(
      request.state,
    );
    const nestedRequest: ShellCommandRequest = {
      depth: request.depth + 1,
      source,
      state: nestedState,
    };
    SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
    request.state.commandCount = nestedState.commandCount;
  }

  static argumentsContainProtectedPath(
    request: WordsEnvironmentRequest,
  ): boolean {
    return request.words
      .map((word) => {
        const resolutionRequest: WordEnvironmentRequest = {
          word,
          environment: request.environment,
        };
        return SkillProviderShellEnvironmentScenario.resolveWord(
          resolutionRequest,
        );
      })
      .some(SkillProviderCommandBoundaryScenario.wordCouldReachProtected);
  }

  static wordCouldReachProtected(word: ShellWord): boolean {
    return (
      word.dynamic ||
      SkillProviderCommandBoundaryScenario.wordHasProtectedMarkers(word)
    );
  }

  static wordHasProtectedMarkers(word: ShellWord): boolean {
    return (
      PROTECTED_SKILL_PATH.test(word.value) ||
      PROTECTED_SKILL_PATH.test(word.source) ||
      PROTECTED_SKILL_FRAGMENTS.every(
        (fragment) =>
          word.value.includes(fragment) || word.source.includes(fragment),
      )
    );
  }

  static addLaunch(request: LaunchRequest): void {
    const value =
      request.state.cwd.length > 0
        ? posix.normalize(
            posix.join(request.state.cwd, request.launch.executable.value),
          )
        : request.launch.executable.value;
    if (!SkillProviderShellCommandScenario.looksLikeRepositoryScript(value))
      return;
    if (request.state.cwdProtected)
      throw new Error(
        'Dynamic protected-skill working directory is forbidden.',
      );
    if (request.state.cwdUnknown)
      throw new Error(
        `Unknown dynamic working directory is forbidden for ${request.launch.executable.source}.`,
      );
    const positionalArguments = request.launch.arguments.map((word) => ({
      dynamic: word.dynamic,
      value: word.value,
    }));
    const scriptLaunch: ShellScriptLaunch = {
      positionalArguments,
      requiresExecuteMode: request.requiresExecuteMode === true,
      shellRuntime: request.shellRuntime === true,
      specifier: value,
      workingDirectory: request.state.cwd,
    };
    request.state.launches.push(scriptLaunch);
  }

  static expandPositionalWords(
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
          const [defaulted4 = match[2]] = [match[1]];
          const argument = request.positionalArguments[Number(defaulted4) - 1];
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
}

export type {
  ShellCommandAnalysis,
  ShellCommandInspection,
  ShellLaunchArgument,
  ShellScriptLaunch,
} from './skill-provider-command-types.ts';

const MAX_SHELL_COMMANDS = 4_096;

const MAX_SHELL_DEPTH = 8;

const MAX_COMMAND_NORMALIZATIONS = 32;

export const PROTECTED_SKILL_FRAGMENTS = [
  '.cortex',
  'dynamic-skills',
  'scripts',
] as const;

const TYPESCRIPT_SCRIPT_REFERENCE =
  /(?:^|[\s"'`:=[({,])((?:\.{0,2}\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.(?:[cm]?[jt]sx?|sh))?)(?=$|[\s"'`,;\]})])/gmu;

export const BUN_BOOLEAN_OPTIONS = new Set(
  '--watch --hot --smol --check --test --version -v --prod'.split(' '),
);

export const BUN_VALUE_OPTIONS = new Set(
  '--cwd --preload --conditions --env-file --config --filter --eval -e --print -p'.split(
    ' ',
  ),
);

export const BUN_SUBCOMMANDS = new Set(
  'add build create init install link outdated pm publish remove run test unlink update x'.split(
    ' ',
  ),
);

export const NODE_BOOLEAN_OPTIONS = new Set(
  '--check --test --version -v'.split(' '),
);

export const NODE_VALUE_OPTIONS = new Set(
  '--conditions --require --import --loader --experimental-loader --env-file --env-file-if-exists --input-type -e --eval --print -p'.split(
    ' ',
  ),
);

export const EXECUTABLE_RUNTIME_OPTIONS = new Set(
  '--cwd --preload --require --import --loader --experimental-loader --env-file --env-file-if-exists --eval -e --print -p'.split(
    ' ',
  ),
);

export const TASK_BOOLEAN_OPTIONS = new Set(
  '--list --parallel --silent --verbose'.split(' '),
);

export const TASK_VALUE_OPTIONS = new Set('--dir --taskfile -d -t'.split(' '));

export const ENV_BOOLEAN_OPTIONS = new Set(
  '-i --ignore-environment'.split(' '),
);

export const ENV_VALUE_OPTIONS = new Set('-u --unset'.split(' '));

export const ENV_ATTACHED_VALUE = /^--unset=[^=]+$/u;

type ResolvedCommandRequest = {
  readonly request: RuntimeCommandRequest;
  readonly start: number;
  readonly words: readonly ShellWord[];
};
