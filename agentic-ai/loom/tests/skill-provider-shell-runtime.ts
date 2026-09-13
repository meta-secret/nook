import { posix } from 'node:path';

import { SkillProviderShellTokenizerScenario } from './skill-provider-shell-tokenizer.ts';

import { SkillProviderTaskBoundaryScenario } from './skill-provider-task-boundary.ts';

import { SkillProviderShellEnvironmentScenario } from './skill-provider-shell-environment.ts';

import { SkillProviderSourcedSeamsScenario } from './skill-provider-sourced-seams.ts';

import {
  PROTECTED_SKILL_PATH,
  SkillProviderShellCommandScenario,
} from './skill-provider-shell-command.ts';

import {
  type EnvPrefixRequest,
  type LaunchRequest,
  type RuntimeCommandRequest,
  type RuntimeExecutable,
  type RuntimeExecutableRequest,
  type ShellCommandRequest,
  type ShellWord,
  shellWordAt,
  type WordEnvironmentRequest,
  type WordsEnvironmentRequest,
} from './skill-provider-command-types.ts';
import {
  SkillProviderCommandBoundaryScenario,
  ENV_BOOLEAN_OPTIONS,
  ENV_VALUE_OPTIONS,
  ENV_ATTACHED_VALUE,
  BUN_BOOLEAN_OPTIONS,
  NODE_BOOLEAN_OPTIONS,
  BUN_VALUE_OPTIONS,
  NODE_VALUE_OPTIONS,
  TASK_BOOLEAN_OPTIONS,
  TASK_VALUE_OPTIONS,
  EXECUTABLE_RUNTIME_OPTIONS,
  BUN_SUBCOMMANDS,
  PROTECTED_SKILL_FRAGMENTS,
} from './skill-provider-command-boundary.ts';
export class ShellRuntimeInvocation {
  private constructor(private readonly request: RuntimeCommandRequest) {}
  static consumeEnvPrefix(request: EnvPrefixRequest): number {
    let index = request.start;
    let options = true;
    while (index < request.words.length) {
      const assignmentRequest: WordEnvironmentRequest = {
        word: shellWordAt([request.words, index]),
        environment: request.environment,
      };
      const assignment =
        SkillProviderShellEnvironmentScenario.assignmentWord(assignmentRequest);
      if (assignment !== false) {
        if (assignment.name === 'PATH')
          throw new Error('env PATH mutation is forbidden.');
        request.environment.set(assignment.name, assignment.value);
        index += 1;
        continue;
      }
      let wordRequest: WordEnvironmentRequest = {
        word: shellWordAt([request.words, index]),
        environment: request.environment,
      };
      const word =
        SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
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
          word: shellWordAt([request.words, index + 1]),
          environment: request.environment,
        };
        const value =
          SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
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

  static analyzeRuntime(request: RuntimeCommandRequest): void {
    return new ShellRuntimeInvocation(request).execute();
  }
  private execute(): void {
    const request = this.request;
    if (request.runtime === 'bun' || request.runtime === 'node') {
      if (
        request.runtime === 'node' &&
        request.state.environment.has('NODE_OPTIONS')
      )
        throw new Error('NODE_OPTIONS execution is forbidden.');
      const executableRequest: RuntimeExecutableRequest = {
        booleanOptions:
          request.runtime === 'bun'
            ? BUN_BOOLEAN_OPTIONS
            : NODE_BOOLEAN_OPTIONS,
        runtime: request.runtime,
        valueOptions:
          request.runtime === 'bun' ? BUN_VALUE_OPTIONS : NODE_VALUE_OPTIONS,
        words: request.words,
      };
      const executables =
        ShellRuntimeInvocation.runtimeExecutable(executableRequest);
      if (executables === false) return;
      for (const launch of executables) {
        const launchRequest: LaunchRequest = { launch, state: request.state };
        SkillProviderCommandBoundaryScenario.addLaunch(launchRequest);
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
      ShellRuntimeInvocation.runtimeExecutable(executableRequest);
      return;
    }
    if (request.runtime === 'bash' || request.runtime === 'sh') {
      ShellRuntimeInvocation.analyzeShellRuntime(request);
      return;
    }
    if (request.runtime === 'npm' && request.words[0]?.value === 'exec') {
      const option = request.words[1];
      const source =
        option?.value === '-c' || option?.value === '--call'
          ? request.words[2]
          : option?.value.startsWith('--call=')
            ? SkillProviderShellEnvironmentScenario.staticWord(
                option.value.slice('--call='.length),
              )
            : false;
      if (!source) throw new Error('Unsupported npm exec command form.');
      if (source.dynamic)
        throw new Error('Dynamic npm exec command is forbidden.');
      const nestedRequest: ShellCommandRequest = {
        depth: request.depth + 1,
        source: source.value,
        state: request.state,
      };
      SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
      return;
    }
    if (request.runtime === 'trap') {
      const action = request.words[0];
      if (!action || action.value === '-' || action.value.startsWith('-'))
        return;
      if (action.dynamic) throw new Error('Dynamic shell trap is forbidden.');
      const nestedRequest: ShellCommandRequest = {
        depth: request.depth + 1,
        source: action.value,
        state: request.state,
      };
      SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
      return;
    }
    if (
      (request.runtime === 'test' || request.runtime === '[') &&
      SkillProviderShellCommandScenario.hasArithmeticTestExecution(
        request.words,
      )
    )
      throw new Error('Arithmetic test operand execution is forbidden.');
    if (request.runtime === 'source' || request.runtime === '.') {
      SkillProviderSourcedSeamsScenario.assertAuditedSource([
        request.runtime,
        request.state,
        request.words,
      ]);
      return;
    }
    if (
      posix.basename(request.runtime) === 'find' &&
      request.words.some((word) =>
        ['-exec', '-execdir', '-ok', '-okdir'].includes(word.value),
      )
    )
      throw new Error('Find command-executing predicate is forbidden.');
    if (request.state.functions.has('command_not_found_handle'))
      throw new Error('Shell command-not-found hooks are forbidden.');
    const directExecutable = SkillProviderShellEnvironmentScenario.staticWord(
      request.runtime,
    );
    if (
      SkillProviderShellCommandScenario.looksLikeRepositoryScript(
        directExecutable.value,
      )
    ) {
      const launch: RuntimeExecutable = {
        executable: directExecutable,
        arguments: request.words,
      };
      const launchRequest: LaunchRequest = {
        launch,
        requiresExecuteMode: true,
        state: request.state,
      };
      SkillProviderCommandBoundaryScenario.addLaunch(launchRequest);
    }
  }

  static analyzeShellRuntime(request: RuntimeCommandRequest): void {
    if (
      SkillProviderShellCommandScenario.shellRuntimeUsesStdinRedirection(
        request.words,
      )
    )
      throw new Error('Shell runtime stdin redirection is forbidden.');
    let index = 0;
    let commandString = false;
    while (index < request.words.length) {
      const word = shellWordAt([request.words, index]);
      if (word.dynamic) {
        SkillProviderShellCommandScenario.assertNoDynamicShellRuntimeScript([
          request.words,
          index,
        ]);
        if (!word.value.startsWith('-') || word.value === '-') return;
        const argumentsRequest: WordsEnvironmentRequest = {
          words: request.words.slice(index),
          environment: request.state.environment,
        };
        if (
          SkillProviderCommandBoundaryScenario.argumentsContainProtectedPath(
            argumentsRequest,
          )
        )
          throw new Error(
            'Dynamic protected-skill shell option construction is forbidden.',
          );
        return;
      }
      if (!word.value.startsWith('-') || word.value === '-') break;
      if (word.value === '--') {
        index += 1;
        break;
      }
      if (
        !/^-+[abefhkmnptuvxBCEHPT]*c?[abefhkmnptuvxBCEHPT]*$/u.test(word.value)
      )
        throw new Error(`Unsupported shell runtime option: ${word.value}`);
      if (word.value.includes('c')) commandString = true;
      index += 1;
    }
    const executable = request.words[index];
    if (!executable) return;
    SkillProviderShellCommandScenario.assertSafeShellRuntime([
      request,
      executable.value,
      commandString,
    ]);
    if (/^[<>]\(/u.test(executable.source))
      throw new Error('Shell process-substitution input is forbidden.');
    if (!ShellRuntimeInvocation.executableIsStatic(executable)) return;
    if (commandString) {
      const nestedState = SkillProviderShellCommandScenario.isolatedShellState(
        request.state,
      );
      nestedState.positionalArguments = request.words.slice(index + 2);
      const nestedRequest: ShellCommandRequest = {
        depth: request.depth + 1,
        source: executable.value,
        state: nestedState,
      };
      SkillProviderCommandBoundaryScenario.analyzeCommandSource(nestedRequest);
      request.state.commandCount = nestedState.commandCount;
      return;
    }
    const launch: RuntimeExecutable = {
      executable,
      arguments: request.words.slice(index + 1),
    };
    const launchRequest: LaunchRequest = {
      launch,
      shellRuntime: true,
      state: request.state,
    };
    SkillProviderCommandBoundaryScenario.addLaunch(launchRequest);
  }

  static runtimeExecutable(
    request: RuntimeExecutableRequest,
  ): readonly RuntimeExecutable[] | false {
    let index = 0;
    let terminated = false;
    while (index < request.words.length) {
      const word = shellWordAt([request.words, index]);
      if (word.value === '--') {
        terminated = true;
        index += 1;
        break;
      }
      if (!word.value.startsWith('-') || word.value === '-') break;
      if (word.dynamic) {
        if (
          request.words
            .slice(index + 1)
            .some(
              (candidate) =>
                !candidate.dynamic &&
                SkillProviderShellCommandScenario.looksLikeRepositoryScript(
                  candidate.value,
                ),
            )
        )
          throw new Error('Dynamic runtime option construction is forbidden.');
        return false;
      }
      const [option = ''] = [word.value.split('=')[0]];
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
              .slice(index + 2)
              .some(
                (candidate) =>
                  !candidate.dynamic &&
                  SkillProviderShellCommandScenario.looksLikeRepositoryScript(
                    candidate.value,
                  ),
              )
          )
            throw new Error('Dynamic runtime option value is forbidden.');
          return false;
        }
        index += 1;
      }
      index += 1;
    }
    if (index === request.words.length) return false;
    const executable = shellWordAt([request.words, index]);
    if (!ShellRuntimeInvocation.executableIsStatic(executable)) {
      if (
        SkillProviderTaskBoundaryScenario.isQuotedDynamicTaskName({
          word: executable,
          runtime: request.runtime,
        })
      )
        return false;
      throw new Error(
        `Dynamic ${request.runtime} executable construction is forbidden: ${executable.source}`,
      );
    }
    if (request.runtime === 'node' && executable.value === 'inspect')
      return SkillProviderShellCommandScenario.nodeInspectExecutables([
        request.words,
        index + 1,
      ]);
    if (
      !terminated &&
      request.runtime === 'bun' &&
      BUN_SUBCOMMANDS.has(executable.value)
    ) {
      const taskName = request.words[index + 1];
      if (!taskName) return false;
      if (!ShellRuntimeInvocation.executableIsStatic(taskName)) return false;
      if (executable.value === 'test')
        return request.words
          .slice(index + 1)
          .filter((word) => !word.value.startsWith('-'))
          .filter((word) =>
            SkillProviderShellCommandScenario.looksLikeRepositoryScript(
              word.value,
            ),
          )
          .map((word) => ({ executable: word, arguments: [] }));
      if (
        executable.value === 'run' &&
        SkillProviderShellCommandScenario.looksLikeRepositoryScript(
          taskName.value,
        )
      )
        return [
          { executable: taskName, arguments: request.words.slice(index + 2) },
        ];
      return false;
    }
    return [{ executable, arguments: request.words.slice(index + 1) }];
  }

  static executableIsStatic(word: ShellWord): boolean {
    if (/^'[\s\S]*'$/u.test(word.source)) return true;
    if (SkillProviderShellTokenizerScenario.hasUnquotedExpansion(word.source))
      throw new Error('Shell expansion in an executable is forbidden.');
    if (word.value.startsWith('/'))
      throw new Error('Absolute runtime entry point is forbidden.');
    if (!word.dynamic) return true;
    if (
      PROTECTED_SKILL_PATH.test(word.value) ||
      PROTECTED_SKILL_PATH.test(word.source) ||
      PROTECTED_SKILL_FRAGMENTS.every((fragment) =>
        word.value.includes(fragment),
      )
    )
      throw new Error(
        'Dynamic protected-skill executable construction is forbidden.',
      );
    return false;
  }
}
