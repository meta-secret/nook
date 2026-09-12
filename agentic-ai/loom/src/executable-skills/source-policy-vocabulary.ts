export enum AllowedBunRootMember {
  StandardInput = 'stdin',
  StandardError = 'stderr',
  StandardOutput = 'stdout',
  Write = 'write',
}

export const ALLOWED_BUN_ROOT_MEMBERS = new Set<string>(
  Object.values(AllowedBunRootMember),
);

export enum AllowedObjectRootMember {
  Freeze = 'freeze',
  HasOwn = 'hasOwn',
  Keys = 'keys',
  Values = 'values',
}

export const ALLOWED_OBJECT_ROOT_MEMBERS = new Set<string>(
  Object.values(AllowedObjectRootMember),
);

export enum ForbiddenEvaluatorMember {
  AsyncFunction = 'AsyncFunction',
  Function = 'Function',
  GeneratorFunction = 'GeneratorFunction',
  LegacyPrototype = '__proto__',
  Constructor = 'constructor',
  Eval = 'eval',
  Prototype = 'prototype',
}

export const FORBIDDEN_EVALUATOR_MEMBERS = new Set<string>(
  Object.values(ForbiddenEvaluatorMember),
);

export enum ForbiddenAmbientGlobal {
  AsyncFunction = 'AsyncFunction',
  BroadcastChannel = 'BroadcastChannel',
  Buffer = 'Buffer',
  Eval = 'eval',
  Fetch = 'fetch',
  Function = 'Function',
  GeneratorFunction = 'GeneratorFunction',
  Global = 'global',
  GlobalThis = 'globalThis',
  Loader = 'Loader',
  Module = 'module',
  PostMessage = 'postMessage',
  Process = 'process',
  Reflect = 'Reflect',
  Require = 'require',
  Self = 'self',
  SetInterval = 'setInterval',
  SetTimeout = 'setTimeout',
  ShadowRealm = 'ShadowRealm',
  SharedWorker = 'SharedWorker',
  WebAssembly = 'WebAssembly',
  WebSocket = 'WebSocket',
  Window = 'window',
  Worker = 'Worker',
}

export const FORBIDDEN_AMBIENT_GLOBALS = new Set<string>(
  Object.values(ForbiddenAmbientGlobal),
);

export enum ExecutableSkillRuntimeModulePrefix {
  Bun = 'bun',
  BunNamespace = 'bun:',
  NodeNamespace = 'node:',
}

export enum ExecutableSkillRelativeModulePrefix {
  Ancestor = '../',
  Descendant = './',
}

export const EXECUTABLE_SKILL_RELATIVE_MODULE_PREFIXES = new Set<string>(
  Object.values(ExecutableSkillRelativeModulePrefix),
);

export enum ExecutableSkillSourceModuleSuffix {
  TypeScript = '.ts',
}

export enum ExecutableSkillModuleSpecifierFragment {
  Fragment = '#',
  Query = '?',
}

export enum AmbientCapabilityRoot {
  Bun = 'Bun',
  Object = 'Object',
}

export enum AllowedImportMetaMember {
  Main = 'main',
}

export enum BunAmbientNodeModule {
  Assert = 'assert',
  AsyncHooks = 'async_hooks',
  Buffer = 'buffer',
  ChildProcess = 'child_process',
  Cluster = 'cluster',
  Console = 'console',
  Constants = 'constants',
  Crypto = 'crypto',
  Datagram = 'dgram',
  DiagnosticsChannel = 'diagnostics_channel',
  Dns = 'dns',
  Domain = 'domain',
  Events = 'events',
  Ffi = 'ffi',
  FileSystem = 'fs',
  Http = 'http',
  Http2 = 'http2',
  Https = 'https',
  Inspector = 'inspector',
  JavaScriptCore = 'jsc',
  Module = 'module',
  Net = 'net',
  OperatingSystem = 'os',
  Path = 'path',
  PerformanceHooks = 'perf_hooks',
  Process = 'process',
  Punycode = 'punycode',
  QueryString = 'querystring',
  Readline = 'readline',
  Sqlite = 'sqlite',
  Stream = 'stream',
  StringDecoder = 'string_decoder',
  Sys = 'sys',
  Timers = 'timers',
  Tls = 'tls',
  TraceEvents = 'trace_events',
  Tty = 'tty',
  Url = 'url',
  Util = 'util',
  V8 = 'v8',
  VirtualMachine = 'vm',
  Wasi = 'wasi',
  WorkerThreads = 'worker_threads',
  Zlib = 'zlib',
}

export const BUN_AMBIENT_NODE_MODULES = new Set<string>(
  Object.values(BunAmbientNodeModule),
);

export const MAXIMUM_EXECUTABLE_SKILL_SOURCE_BYTES = 1024 * 1024;

export const MAXIMUM_EXECUTABLE_SKILL_SOURCE_PATH_BYTES = 4096;

export const MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIER_BYTES = 4096;

export const MAXIMUM_EXECUTABLE_SKILL_MODULE_SPECIFIERS = 256;
