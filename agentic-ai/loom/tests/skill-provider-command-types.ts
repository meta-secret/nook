import { UntrustedYamlBoundary } from '../src/lib/guards.ts';
import type { UntrustedYamlNode } from '../src/lib/guards.ts';

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

/** Owns conversion and narrowing for a parsed configuration document. */
export class SkillProviderConfigurationDocumentScenario {
  static configurationNodeFromHost(
    value: UntrustedYamlNode,
  ): ConfigurationNode {
    if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    )
      return value;
    if (UntrustedYamlBoundary.isList(value))
      return value.map((entry) =>
        SkillProviderConfigurationDocumentScenario.configurationNodeFromHost(
          entry,
        ),
      );
    if (UntrustedYamlBoundary.isRecord(value)) {
      const result: Record<string, ConfigurationNode> = {};
      for (const [key, entry] of Object.entries(value))
        result[key] =
          SkillProviderConfigurationDocumentScenario.configurationNodeFromHost(
            entry,
          );
      return result;
    }
    if (!value && typeof value === 'object') return false;
    throw new Error('Configuration contains an unsupported value.');
  }

  static isConfigurationList(
    value: ConfigurationNode,
  ): value is readonly ConfigurationNode[] {
    return Array.isArray(value);
  }

  static isConfigurationMapping(
    value: ConfigurationNode,
  ): value is Readonly<Record<string, ConfigurationNode>> {
    return value instanceof Object && !Array.isArray(value);
  }

  static stringMapFromHost(
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
}

export const configurationNodeFromHost =
  SkillProviderConfigurationDocumentScenario.configurationNodeFromHost;
export const isConfigurationList =
  SkillProviderConfigurationDocumentScenario.isConfigurationList;
export const isConfigurationMapping =
  SkillProviderConfigurationDocumentScenario.isConfigurationMapping;
export const stringMapFromHost =
  SkillProviderConfigurationDocumentScenario.stringMapFromHost;

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

/** Owns required access to a parsed shell-word sequence. */
export class SkillProviderShellTokenScenario {
  static shellWordAt([words, index]: readonly [
    readonly ShellWord[],
    number,
  ]): ShellWord {
    const word = words[index];
    if (!word) throw new Error(`Missing shell word at index ${index}.`);
    return word;
  }
}

export const shellWordAt = SkillProviderShellTokenScenario.shellWordAt;

/** Owns required indexed access for bounded command-fixture sequences. */
export class SkillProviderCommandFixtureSequenceScenario {
  static itemAt<T>([items, index]: readonly [readonly T[], number]): T {
    let currentIndex = 0;
    for (const item of items) {
      if (currentIndex === index) return item;
      currentIndex += 1;
    }
    throw new Error(`Missing item at index ${index}.`);
  }
}

export const itemAt = SkillProviderCommandFixtureSequenceScenario.itemAt;

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
