import { posix } from 'node:path';
import { consumeEnvPrefix } from './skill-provider-command-boundary.ts';
import {
  ShellSeparator,
  type ShellToken,
  type ShellWord,
} from './skill-provider-command-types.ts';
import type { ConfigurationReference } from './skill-provider-config-types.ts';
import { resolveDispatchCommand } from './skill-provider-shell-dispatch.ts';
import { tokenizeShell } from './skill-provider-shell-tokenizer.ts';

export type CommandConfigurationRequest = {
  readonly commands: readonly string[];
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly workingDirectory: string;
};
export type EslintConfigurationRequest = CommandConfigurationRequest;

enum ConfigurationTool {
  Eslint = 'ESLint',
  Playwright = 'Playwright',
}

type ToolInvocation = {
  readonly argumentStart: number;
  readonly tool: ConfigurationTool;
};

type ConfigurationSelectionRequest = {
  readonly tool: ConfigurationTool;
  readonly words: readonly ShellWord[];
};

type TaskfileSelectionRequest = {
  readonly argumentStart: number;
  readonly importer: string;
  readonly initialDirectory: string | false;
  readonly words: readonly ShellWord[];
};

type ImplicitConfigurationRequest = {
  readonly initialDirectory: string;
  readonly names: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
};

const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
] as const;

const PLAYWRIGHT_CONFIG_NAMES = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.cts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
] as const;

export function commandConfigurationReferences(
  request: CommandConfigurationRequest,
): readonly ConfigurationReference[] {
  return request.commands.flatMap((command) =>
    commandReferences([
      command,
      request.importer,
      request.sources,
      request.workingDirectory,
    ]),
  );
}

export const eslintConfigurationReferences = commandConfigurationReferences;

function commandReferences([
  command,
  importer,
  sources,
  initialDirectory,
]: readonly [string, string, ReadonlyMap<string, string>, string]) {
  if (
    !/(?:^|[\s/])(?:eslint|playwright|go-task|task)(?:\s|$)/u.test(command) &&
    !/(?:--taskfile(?:=|\s)|(?:^|\s)-t(?:=|\s))/u.test(command)
  )
    return [];
  const references: ConfigurationReference[] = [];
  let directory: string | false = initialDirectory;
  for (const words of commandSegments(tokenizeShell(command))) {
    const start = firstCommandWord(words);
    const runtime = words[start];
    if (!runtime) continue;
    if (posix.basename(runtime.value) === 'cd') {
      const target = words[start + 1];
      directory =
        directory !== false &&
        target &&
        !target.dynamic &&
        words.length === start + 2
          ? repositoryCommandDirectory([directory, target.value])
          : false;
      continue;
    }
    if (mightSelectTaskfile([words, start])) {
      if (runtime.dynamic) {
        const wrapped = words[start + 1];
        const wrappedName = posix.basename(wrapped?.value ?? '');
        if (wrappedName !== 'task' && wrappedName !== 'go-task') continue;
        throw new Error('Dynamic Task dispatch wrapper is forbidden.');
      }
      const dispatchRequest = {
        command: runtime,
        environment: new Map(),
        index: start + 1,
        words,
      };
      const dispatch = resolveDispatchCommand(dispatchRequest);
      const runtimeName = posix.basename(
        dispatch ? dispatch.command.value : '',
      );
      if (runtimeName === 'task' || runtimeName === 'go-task') {
        const taskfileRequest: TaskfileSelectionRequest = {
          argumentStart: dispatch ? dispatch.index : words.length,
          importer,
          initialDirectory: directory,
          words,
        };
        const taskfile = selectedTaskfileReference(taskfileRequest);
        if (taskfile !== false) {
          references.push(taskfile);
          continue;
        }
      }
    }
    const invocation = toolInvocation([words, start]);
    if (invocation === false) continue;
    if (directory === false)
      throw new Error('Dynamic package command working directory.');
    const selectionRequest: ConfigurationSelectionRequest = {
      tool: invocation.tool,
      words: words.slice(invocation.argumentStart),
    };
    const selection = selectedConfiguration(selectionRequest);
    if (selection === false) continue;
    const names =
      invocation.tool === ConfigurationTool.Eslint
        ? ESLINT_CONFIG_NAMES
        : PLAYWRIGHT_CONFIG_NAMES;
    const implicitRequest: ImplicitConfigurationRequest = {
      initialDirectory: directory,
      names,
      sources,
    };
    const selected =
      selection === true
        ? nearestImplicitConfiguration(implicitRequest)
        : repositoryPath([directory, selection, invocation.tool]);
    if (selected === false) continue;
    const reference: ConfigurationReference = {
      importerRelative: true,
      positionalArguments: false,
      required: true,
      requiresExecuteMode: false,
      shellRuntime: false,
      specifier: posix.relative(posix.dirname(importer), selected),
      taskInclude: false,
      workingDirectory: directory,
    };
    references.push(reference);
  }
  return references;
}

function mightSelectTaskfile([words, start]: readonly [
  readonly ShellWord[],
  number,
]): boolean {
  return words.slice(start).some((word) => {
    const value = posix.basename(word.value);
    return (
      value === 'task' ||
      value === 'go-task' ||
      value === '--taskfile' ||
      value.startsWith('--taskfile=') ||
      value === '-t' ||
      value.startsWith('-t=')
    );
  });
}

function selectedTaskfileReference(
  request: TaskfileSelectionRequest,
): ConfigurationReference | false {
  let directory = request.initialDirectory;
  let selection: ShellWord | false = false;
  let taskNameSeen = false;
  for (
    let index = request.argumentStart;
    index < request.words.length;
    index += 1
  ) {
    const word = request.words[index] as ShellWord;
    if (word.value === '--') {
      taskNameSeen = true;
      continue;
    }
    if (word.value === '--taskfile=' || word.value === '-t=')
      throw new Error('Taskfile selection has no path.');
    if (word.value === '--taskfile' || word.value === '-t') {
      const value = request.words[index + 1];
      if (!value || value.value.startsWith('-'))
        throw new Error('Taskfile selection has no path.');
      if (selection !== false)
        throw new Error('Duplicate Taskfile selection is forbidden.');
      selection = value;
      index += 1;
      continue;
    }
    if (word.value === '--dir' || word.value === '-d') {
      const value = request.words[index + 1];
      if (!value || value.dynamic || value.value.startsWith('-'))
        throw new Error('Task working directory is missing or dynamic.');
      directory =
        directory === false
          ? false
          : repositoryCommandDirectory([directory, value.value]);
      index += 1;
      continue;
    }
    const attachedDirectory = /^(?:--dir=|-d=)(.+)$/u.exec(word.value);
    if (attachedDirectory) {
      if (word.dynamic)
        throw new Error('Task working directory is missing or dynamic.');
      directory =
        directory === false
          ? false
          : repositoryCommandDirectory([directory, attachedDirectory[1] ?? '']);
      continue;
    }
    const attached = /^(?:--taskfile=|-t=)(.+)$/u.exec(word.value);
    if (attached) {
      if (selection !== false)
        throw new Error('Duplicate Taskfile selection is forbidden.');
      selection = { ...word, value: attached[1] ?? '' };
      continue;
    }
    if (word.dynamic && !taskNameSeen)
      throw new Error('Dynamic Task option construction is forbidden.');
    if (!word.value.startsWith('-')) taskNameSeen = true;
  }
  if (selection === false) return false;
  if (directory === false)
    throw new Error('Dynamic package command working directory.');
  const selected = repositoryTaskfilePath([directory, selection]);
  return {
    importerRelative: true,
    positionalArguments: false,
    required: true,
    requiresExecuteMode: false,
    shellRuntime: false,
    specifier: posix.relative(posix.dirname(request.importer), selected),
    taskInclude: true,
    workingDirectory: directory,
  };
}

function repositoryTaskfilePath([directory, selection]: readonly [
  string,
  ShellWord,
]): string {
  let path = selection.value;
  if (selection.dynamic) {
    const workspace = /^\$\{?GITHUB_WORKSPACE\}?\/(.+)$/u.exec(path)?.[1];
    if (!workspace) throw new Error('Dynamic Taskfile selection is forbidden.');
    path = workspace.replace(/^\.nook\/release-workflow\//u, '');
  }
  if (path.length === 0 || path.startsWith('/'))
    throw new Error('Taskfile path escapes the repository.');
  const resolved = posix.normalize(posix.join(directory, path));
  if (resolved === '..' || resolved.startsWith('../'))
    throw new Error('Taskfile path escapes the repository.');
  return resolved.replace(/^\.$/u, '');
}

function commandSegments(
  tokens: readonly ShellToken[],
): readonly ShellWord[][] {
  const segments: ShellWord[][] = [[]];
  for (const token of tokens) {
    if (typeof token === 'string') {
      if (token === ShellSeparator.OpenParenthesis) continue;
      segments.push([]);
      continue;
    }
    segments.at(-1)?.push(token);
  }
  return segments;
}

function firstCommandWord(words: readonly ShellWord[]): number {
  let index = 0;
  while (/^[A-Za-z_]\w*=/u.test(words[index]?.value ?? '')) index += 1;
  if (posix.basename(words[index]?.value ?? '') === 'env') {
    const envRequest = {
      environment: new Map(),
      start: index + 1,
      words,
    };
    index = consumeEnvPrefix(envRequest);
  }
  return index;
}

function toolInvocation([words, start]: readonly [
  readonly ShellWord[],
  number,
]): ToolInvocation | false {
  const runtime = posix.basename(words[start]?.value ?? '');
  const direct = configurationTool(runtime);
  if (direct !== false) return { argumentStart: start + 1, tool: direct };
  const wrapperTool = words[start + 1] ?? false;
  if ((runtime === 'bunx' || runtime === 'npx') && wrapperTool !== false) {
    const wrapped = configurationTool(wrapperTool.value);
    if (wrapped !== false) return { argumentStart: start + 2, tool: wrapped };
  }
  const execTool = words[start + 2] ?? false;
  if (
    (runtime === 'bun' || runtime === 'npm') &&
    (words[start + 1]?.value === 'x' || words[start + 1]?.value === 'exec') &&
    execTool !== false
  ) {
    const wrapped = configurationTool(execTool.value);
    if (wrapped !== false) return { argumentStart: start + 3, tool: wrapped };
  }
  return false;
}

function configurationTool(value: string): ConfigurationTool | false {
  if (value === 'eslint') return ConfigurationTool.Eslint;
  return value === 'playwright' ? ConfigurationTool.Playwright : false;
}

function selectedConfiguration(
  request: ConfigurationSelectionRequest,
): string | true | false {
  let noConfigLookup = false;
  for (let index = 0; index < request.words.length; index += 1) {
    const word = request.words[index] as ShellWord;
    if (
      request.tool === ConfigurationTool.Eslint &&
      word.value === '--no-config-lookup'
    ) {
      noConfigLookup = true;
      continue;
    }
    if (word.value === '--config' || word.value === '-c') {
      const value = request.words[index + 1];
      if (!value || value.dynamic)
        throw new Error(`Dynamic ${request.tool} configuration selection.`);
      return value.value;
    }
    if (word.value.startsWith('--config=')) {
      if (word.dynamic)
        throw new Error(`Dynamic ${request.tool} configuration selection.`);
      return word.value.slice('--config='.length);
    }
  }
  return noConfigLookup ? false : true;
}

function nearestImplicitConfiguration(
  request: ImplicitConfigurationRequest,
): string | false {
  let directory = request.initialDirectory;
  while (true) {
    for (const name of request.names) {
      const candidate = posix.normalize(posix.join(directory, name));
      if (request.sources.has(candidate)) return candidate;
    }
    if (directory.length === 0) return false;
    const parent = posix.dirname(directory).replace(/^\.$/u, '');
    if (parent === directory) return false;
    directory = parent;
  }
}

function repositoryCommandDirectory([directory, path]: readonly [
  string,
  string,
]): string | false {
  if (path.length === 0 || path.startsWith('/')) return false;
  const resolved = posix.normalize(posix.join(directory, path));
  if (resolved === '..' || resolved.startsWith('../')) return false;
  return resolved.replace(/^\.$/u, '');
}

function repositoryPath([directory, path, tool]: readonly [
  string,
  string,
  ConfigurationTool,
]): string {
  if (path.length === 0 || path.startsWith('/'))
    throw new Error(`${tool} configuration path escapes the repository.`);
  const resolved = posix.normalize(posix.join(directory, path));
  if (resolved === '..' || resolved.startsWith('../'))
    throw new Error(`${tool} configuration path escapes the repository.`);
  return resolved.replace(/^\.$/u, '');
}
