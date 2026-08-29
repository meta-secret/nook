import { posix } from 'node:path';
import {
  ShellSeparator,
  type ShellToken,
  type ShellWord,
} from './skill-provider-command-types.ts';
import type { ConfigurationReference } from './skill-provider-config-types.ts';
import { tokenizeShell } from './skill-provider-shell-tokenizer.ts';

export type EslintConfigurationRequest = {
  readonly commands: readonly string[];
  readonly importer: string;
  readonly sources: ReadonlyMap<string, string>;
  readonly workingDirectory: string;
};

const ESLINT_CONFIG_NAMES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
] as const;

export function eslintConfigurationReferences(
  request: EslintConfigurationRequest,
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

function commandReferences([
  command,
  importer,
  sources,
  initialDirectory,
]: readonly [string, string, ReadonlyMap<string, string>, string]) {
  if (!/(?:^|[\s/])eslint(?:\s|$)/u.test(command)) return [];
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
          ? repositoryPath([directory, target.value])
          : false;
      continue;
    }
    const eslint = eslintArgumentStart([words, start]);
    if (eslint === false) continue;
    if (directory === false)
      throw new Error('Dynamic package command working directory.');
    const selection = selectedConfiguration(words.slice(eslint));
    if (selection === false) continue;
    const selected =
      selection === true
        ? nearestImplicitConfiguration([sources, directory])
        : repositoryPath([directory, selection]);
    if (selected === false) continue;
    const reference: ConfigurationReference = {
      importerRelative: true,
      positionalArguments: false,
      required: true,
      requiresExecuteMode: false,
      specifier: posix.relative(posix.dirname(importer), selected),
      taskInclude: false,
      workingDirectory: directory,
    };
    references.push(reference);
  }
  return references;
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
  while (
    /^[A-Za-z_]\w*=/u.test(words[index]?.value ?? '') &&
    !(words[index]?.dynamic ?? false)
  )
    index += 1;
  if (words[index]?.value === 'env') {
    index += 1;
    while (/^[A-Za-z_]\w*=/u.test(words[index]?.value ?? '')) index += 1;
  }
  return index;
}

function eslintArgumentStart([words, start]: readonly [
  readonly ShellWord[],
  number,
]): number | false {
  const runtime = posix.basename(words[start]?.value ?? '');
  if (runtime === 'eslint') return start + 1;
  if (
    (runtime === 'bunx' || runtime === 'npx') &&
    words[start + 1]?.value === 'eslint'
  )
    return start + 2;
  if (
    (runtime === 'bun' || runtime === 'npm') &&
    (words[start + 1]?.value === 'x' || words[start + 1]?.value === 'exec') &&
    words[start + 2]?.value === 'eslint'
  )
    return start + 3;
  return false;
}

function selectedConfiguration(
  words: readonly ShellWord[],
): string | true | false {
  let noConfigLookup = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as ShellWord;
    if (word.value === '--no-config-lookup') {
      noConfigLookup = true;
      continue;
    }
    if (word.value === '--config' || word.value === '-c') {
      const value = words[index + 1];
      if (!value || value.dynamic)
        throw new Error('Dynamic ESLint configuration selection.');
      return value.value;
    }
    if (word.value.startsWith('--config=')) {
      if (word.dynamic)
        throw new Error('Dynamic ESLint configuration selection.');
      return word.value.slice('--config='.length);
    }
  }
  return noConfigLookup ? false : true;
}

function nearestImplicitConfiguration([sources, initialDirectory]: readonly [
  ReadonlyMap<string, string>,
  string,
]): string | false {
  let directory = initialDirectory;
  while (true) {
    for (const name of ESLINT_CONFIG_NAMES) {
      const candidate = posix.normalize(posix.join(directory, name));
      if (sources.has(candidate)) return candidate;
    }
    if (directory.length === 0) return false;
    const parent = posix.dirname(directory).replace(/^\.$/u, '');
    if (parent === directory) return false;
    directory = parent;
  }
}

function repositoryPath([directory, path]: readonly [string, string]): string {
  if (path.length === 0 || path.startsWith('/'))
    throw new Error('ESLint configuration path escapes the repository.');
  const resolved = posix.normalize(posix.join(directory, path));
  if (resolved === '..' || resolved.startsWith('../'))
    throw new Error('ESLint configuration path escapes the repository.');
  return resolved.replace(/^\.$/u, '');
}
