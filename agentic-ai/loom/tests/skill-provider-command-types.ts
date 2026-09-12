export type RunnableCommandInspection = {
  readonly path: string;
  readonly source: string;
};

export type ShellCommandInspection = {
  readonly positionalArguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
  readonly sourcePath: string | false;
};

export type ShellLaunchArgument = {
  readonly dynamic: boolean;
  readonly value: string;
};

export type ShellScriptLaunch = {
  readonly positionalArguments: readonly ShellLaunchArgument[];
  readonly requiresExecuteMode: boolean;
  readonly shellRuntime: boolean;
  readonly specifier: string;
  readonly workingDirectory: string;
};

export type ShellCommandAnalysis = {
  readonly launches: readonly ShellScriptLaunch[];
};

export type ConfigurationNode =
  | boolean
  | number
  | string
  | readonly ConfigurationNode[]
  | { readonly [key: string]: ConfigurationNode };

export function configurationNodeFromHost(
  value: UntrustedYamlNode,
): ConfigurationNode {
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return value;
  if (UntrustedYamlBoundary.isList(value))
    return value.map(configurationNodeFromHost);
  if (UntrustedYamlBoundary.isRecord(value)) {
    const result: Record<string, ConfigurationNode> = {};
    for (const [key, entry] of Object.entries(value))
      result[key] = configurationNodeFromHost(entry);
    return result;
  }
  if (!value && typeof value === 'object') return false;
  throw new Error('Configuration contains an unsupported value.');
}

export function isConfigurationList(
  value: ConfigurationNode,
): value is readonly ConfigurationNode[] {
  return Array.isArray(value);
}

export function isConfigurationMapping(
  value: ConfigurationNode,
): value is Readonly<Record<string, ConfigurationNode>> {
  return value instanceof Object && !Array.isArray(value);
}

export function stringMapFromHost(
  value: UntrustedYamlNode,
): Readonly<Record<string, string>> | false {
  if (!UntrustedYamlBoundary.isRecord(value)) return false;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return false;
    result[key] = entry;
  }
  return result;
}

export type ShellWord = {
  readonly dynamic: boolean;
  readonly source: string;
  readonly value: string;
};

export enum ShellSeparator {
  And = '&&',
  Background = '&',
  Case = ';;',
  CloseParenthesis = ')',
  Newline = '\n',
  Or = '||',
  OpenParenthesis = '(',
  Pipe = '|',
  Sequence = ';',
}

export type ShellToken = ShellWord | ShellSeparator;

export function shellWordAt([words, index]: readonly [
  readonly ShellWord[],
  number,
]): ShellWord {
  const word = words[index];
  if (!word) throw new Error(`Missing shell word at index ${index}.`);
  return word;
}

export function itemAt<T>([items, index]: readonly [readonly T[], number]): T {
  let currentIndex = 0;
  for (const item of items) {
    if (currentIndex === index) return item;
    currentIndex += 1;
  }
  throw new Error(`Missing item at index ${index}.`);
}

export type ShellEnvironment = Map<string, ShellWord>;
export type ConfigurationMapping = Readonly<Record<string, ConfigurationNode>>;

export type CommandCollectionRequest = {
  readonly target: string[];
  readonly value: ConfigurationNode;
};

export type TaskStaticVariableRequest = {
  readonly root: ConfigurationMapping;
  readonly task: ConfigurationMapping;
};

export type TaskTemplateRequest = {
  readonly source: string;
  readonly values: ReadonlyMap<string, string>;
};

export type WordEnvironmentRequest = {
  readonly environment: ShellEnvironment;
  readonly word: ShellWord;
};

export type WordsEnvironmentRequest = {
  readonly environment: ShellEnvironment;
  readonly words: readonly ShellWord[];
};

export type EnvPrefixRequest = WordsEnvironmentRequest & {
  readonly start: number;
};

export type ShellParseState = {
  readonly aliases: Map<string, string>;
  casePattern: boolean;
  commandCount: number;
  cwd: string;
  cwdProtected: boolean;
  cwdUnknown: boolean;
  readonly environment: ShellEnvironment;
  readonly functions: Map<string, string>;
  readonly launches: ShellScriptLaunch[];
  positionalArguments: readonly ShellWord[] | false;
  readonly sourcePath: string | false;
};

export type RuntimeExecutable = {
  readonly arguments: readonly ShellWord[];
  readonly executable: ShellWord;
};

export type LaunchRequest = {
  readonly launch: RuntimeExecutable;
  readonly requiresExecuteMode?: true;
  readonly shellRuntime?: true;
  readonly state: ShellParseState;
};

export type PositionalWordsRequest = {
  readonly positionalArguments: readonly ShellWord[] | false;
  readonly words: readonly ShellWord[];
};

export type ShellCommandRequest = {
  readonly depth: number;
  readonly source: string;
  readonly state: ShellParseState;
};

export type RuntimeCommandRequest = {
  readonly depth: number;
  readonly runtime: string;
  readonly state: ShellParseState;
  readonly words: readonly ShellWord[];
};

export type RuntimeExecutableRequest = {
  readonly booleanOptions: ReadonlySet<string>;
  readonly runtime: string;
  readonly valueOptions: ReadonlySet<string>;
  readonly words: readonly ShellWord[];
};
import { UntrustedYamlBoundary } from '../src/lib/guards.ts';
import type { UntrustedYamlNode } from '../src/lib/guards.ts';
