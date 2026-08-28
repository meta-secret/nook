export type RunnableCommandInspection = {
  readonly path: string;
  readonly source: string;
};

export type ShellCommandInspection = {
  readonly positionalArguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
};

export type ShellLaunchArgument = {
  readonly dynamic: boolean;
  readonly value: string;
};

export type ShellScriptLaunch = {
  readonly positionalArguments: readonly ShellLaunchArgument[];
  readonly specifier: string;
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
  casePattern: boolean;
  commandCount: number;
  cwd: string;
  cwdProtected: boolean;
  cwdUnknown: boolean;
  readonly environment: ShellEnvironment;
  readonly functions: Map<string, string>;
  readonly launches: ShellScriptLaunch[];
  positionalArguments: readonly ShellWord[] | false;
};

export type RuntimeExecutable = {
  readonly arguments: readonly ShellWord[];
  readonly executable: ShellWord;
};

export type LaunchRequest = {
  readonly launch: RuntimeExecutable;
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
