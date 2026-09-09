import ts from 'typescript';
export enum SubprocessCallKind {
  Bun = 'bun',
  BunNamespace = 'bunNamespace',
  BunShell = 'bunShell',
  Exec = 'exec',
  ExecFile = 'execFile',
  Fork = 'fork',
  Namespace = 'namespace',
  ReflectApply = 'reflectApply',
  ReflectConstruct = 'reflectConstruct',
  ReflectDynamic = 'reflectDynamic',
  ReflectNamespace = 'reflectNamespace',
  HostCommand = 'hostCommand',
  RunCommand = 'runCommand',
  Spawn = 'spawn',
  Worker = 'worker',
  WorkerNamespace = 'workerNamespace',
}

export type TaggedTemplateText = {
  readonly dynamic: boolean;
  readonly value: string;
};

export type BunShellTemplateRequest = {
  readonly capability: SubprocessCallKind | false;
  readonly evaluate: (expression: ts.Expression) => TaggedTemplateText;
  readonly tagged: ts.TaggedTemplateExpression;
};

export type SerializedSubprocessCommand = {
  readonly cwd: TaggedTemplateText | false;
  readonly shellSource: boolean;
  readonly words: readonly TaggedTemplateText[];
};

export type SubprocessCwdRequest = {
  readonly allowDynamicCwd: boolean;
  readonly allowDynamicEnvironment: boolean;
  readonly call: ts.CallExpression | ts.NewExpression;
  readonly evaluate: (expression: ts.Expression) => TaggedTemplateText;
  readonly kind: SubprocessCallKind;
  readonly resolveObject: (
    expression: ts.Expression,
  ) => ts.ObjectLiteralExpression | false;
  readonly sourcePath: string;
};

export type ChildProcessMemberRequest = readonly [
  SubprocessCallKind | false,
  string | false,
];

export type UnsupportedCallArgumentRequest = {
  readonly call: string;
  readonly capability: (
    expression: ts.Expression,
  ) => SubprocessCallKind | false;
  readonly expression: ts.Expression;
  readonly resolve: (expression: ts.Expression) => ts.Expression;
  readonly sourcePath: string;
};

export type SafeSubprocessEnvironmentValueRequest = {
  readonly name: string;
  readonly value: ts.Expression;
};

export enum PlatformPathEnvironmentKey {
  Posix = 'PATH',
  Windows = 'Path',
}

export type PlatformPathEnvironmentValueRequest = {
  readonly value: ts.Expression;
  readonly name: PlatformPathEnvironmentKey;
};
