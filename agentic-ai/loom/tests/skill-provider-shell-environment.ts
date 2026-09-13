import { posix } from 'node:path';

import { shellWordAt } from './skill-provider-command-types.ts';

import type {
  ShellEnvironment,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

export class SkillProviderShellEnvironmentScenario {
  private constructor(private readonly request: string) {}

  static assignmentWord(
    request: WordEnvironmentRequest,
  ): { readonly name: string; readonly value: ShellWord } | false {
    const match = request.word.value.match(SHELL_ASSIGNMENT);
    if (!match) return false;
    const [name = ''] = [match[1]];
    const [operator = '='] = [match[2]];
    const [rawValue = ''] = [match[3]];
    if (
      REPOSITORY_ROOT_ASSIGNMENT.test(rawValue) ||
      SCRIPT_DIRECTORY_ASSIGNMENT.test(rawValue)
    )
      return {
        name,
        value: SkillProviderShellEnvironmentScenario.staticWord('.'),
      };
    if (EPHEMERAL_DIRECTORY.test(rawValue))
      return {
        name,
        value: SkillProviderShellEnvironmentScenario.staticWord(
          '/tmp/nook-ephemeral',
        ),
      };
    const staticDefault = STATIC_EXECUTABLE_DEFAULT.exec(rawValue);
    if (staticDefault) {
      const [defaulted1 = ''] = [staticDefault[1]];
      const [defaulted2 = ''] = [staticDefault[2]];
      const [existing = false] = [request.environment.get(defaulted1)];
      if (existing !== false && !existing.dynamic)
        return {
          name,
          value:
            existing.value.length > 0
              ? existing
              : SkillProviderShellEnvironmentScenario.staticWord(defaulted2),
        };
      return {
        name,
        value: {
          source: rawValue,
          value: defaulted2,
          dynamic: true,
        },
      };
    }
    const word: ShellWord = {
      source: rawValue,
      value: rawValue,
      dynamic: DYNAMIC_SHELL.test(rawValue),
    };
    const wordRequest: WordEnvironmentRequest = {
      word,
      environment: request.environment,
    };
    const value =
      SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
    const directory = /^\$\(cd "?([^"$`]*)"? && pwd\)$/u.exec(value.value)?.[1];
    const resolved = directory
      ? {
          name,
          value: SkillProviderShellEnvironmentScenario.staticWord(
            posix.normalize(directory),
          ),
        }
      : { name, value };
    if (operator !== '+=') return resolved;
    const existing = request.environment.get(name);
    if (!existing) return resolved;
    return {
      name,
      value: {
        dynamic: existing.dynamic || resolved.value.dynamic,
        source: `${existing.source}${resolved.value.source}`,
        value: `${existing.value}${resolved.value.value}`,
      },
    };
  }

  static consumeAssignments([words, start, environment]: readonly [
    readonly ShellWord[],
    number,
    ShellEnvironment,
  ]): number {
    let index = start;
    for (; index < words.length; index += 1) {
      const request = { word: shellWordAt([words, index]), environment };
      const assignment =
        SkillProviderShellEnvironmentScenario.assignmentWord(request);
      if (assignment === false) break;
      environment.set(assignment.name, assignment.value);
    }
    return index;
  }

  static resolveWord(request: WordEnvironmentRequest): ShellWord {
    let value = '';
    let dynamic = false;
    let end = 0;
    for (const match of request.word.value.matchAll(
      /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/gu,
    )) {
      const replacement = request.environment.get(match[1] || match[2] || '');
      value += request.word.value.slice(end, match.index);
      if (!replacement) {
        value += match[0];
        dynamic = true;
      } else {
        value += replacement.value;
        dynamic ||= replacement.dynamic;
      }
      end = match.index + match[0].length;
      SkillProviderShellEnvironmentScenario.assertBoundedSource(value);
    }
    value += request.word.value.slice(end);
    SkillProviderShellEnvironmentScenario.assertBoundedSource(value);
    const literal = /^'[\s\S]*'$/u.test(request.word.source);
    return {
      source: request.word.source,
      value,
      dynamic: dynamic || (!literal && DYNAMIC_SHELL.test(value)),
    };
  }

  static staticWord(value: string): ShellWord {
    return { source: value, value, dynamic: false };
  }

  static assertBoundedSource(source: string): void {
    return new SkillProviderShellEnvironmentScenario(source).execute();
  }

  private execute(): void {
    const source = this.request;
    if (encoder.encode(source).byteLength > MAX_SHELL_BYTES)
      throw new Error('Shell source exceeds its UTF-8 byte bound.');
  }
}

const MAX_SHELL_BYTES = 65_536;

const DYNAMIC_SHELL = /\{\{|\$\(|`|\$\{[^}]*[:#%?+=-]|\$(?:\{|[A-Za-z_@])/u;

const SHELL_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)(\+?=)(.*)$/su;

const STATIC_EXECUTABLE_DEFAULT = /^\$\{([A-Za-z_]\w*):-([^}]*)\}$/u;

const EPHEMERAL_DIRECTORY = /^\$\(mktemp -d\)$/u;

const REPOSITORY_ROOT_ASSIGNMENT =
  /^(?:"?\$\{REPO_ROOT:-\$\(git rev-parse --show-toplevel\)\}"?|\$\(git rev-parse --show-toplevel\)|\$\(cd "\$scripts_dir\/\.\.\/\.\." && pwd\))$/u;

const SCRIPT_DIRECTORY_ASSIGNMENT =
  /^\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)(?:\/\.\.\/\.\.)?" && pwd\)$/u;

const encoder = new TextEncoder();
