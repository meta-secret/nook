import { posix } from 'node:path';
import { workflowCommandSources } from './skill-provider-workflow-commands.ts';
import type {
  CommandCollectionRequest,
  ConfigurationNode,
  RunnableCommandInspection,
  TaskStaticVariableRequest,
  TaskTemplateRequest,
} from './skill-provider-command-types.ts';

const MAX_CONFIG_BYTES = 65_536;
const MAX_COMMANDS = 4_096;
const MAX_COMMAND_BYTES = 262_144;

type ShellVariableCollectionRequest = {
  readonly node: Readonly<Record<string, ConfigurationNode>>;
  readonly target: string[];
};
type TaskEnvironmentRequest = {
  readonly root: Readonly<Record<string, ConfigurationNode>>;
  readonly task: Readonly<Record<string, ConfigurationNode>>;
};
type ResolvedTaskVariableRequest = TaskStaticVariableRequest & {
  readonly taskfileDirectory: string;
};
type TaskCommandRequest = {
  readonly document: ConfigurationNode;
  readonly taskfilePath: string;
};
type TaskShellVariableRequest = {
  readonly source: string;
  readonly values: ReadonlyMap<string, string>;
};

export function runnableCommandSources(
  inspection: RunnableCommandInspection,
): readonly string[] {
  assertRunnableConfigurationBytes(inspection.source);
  if (inspection.path.endsWith('bunfig.toml')) {
    if (/^\s*preload\s*=/mu.test(inspection.source))
      throw new Error('Bun preload configuration is forbidden.');
    return [];
  }
  if (inspection.path.endsWith('package.json')) {
    const document = JSON.parse(inspection.source) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    return bounded(document.scripts ? Object.values(document.scripts) : []);
  }
  if (/\.sh$/u.test(inspection.path) || posix.extname(inspection.path) === '')
    return [inspection.source.replace(/^#![^\n]*(?:\n|$)/u, '')];
  if (!/\.ya?ml$/u.test(inspection.path)) return [];
  const document = Bun.YAML.parse(inspection.source) as ConfigurationNode;
  if (/^\.github\/workflows\//u.test(inspection.path)) {
    const request = { action: false, document };
    return bounded(workflowCommandSources(request));
  }
  if (/(^|\/)action\.ya?ml$/u.test(inspection.path)) {
    const request = { action: true, document };
    return bounded(workflowCommandSources(request));
  }
  const request: TaskCommandRequest = {
    document,
    taskfilePath: inspection.path,
  };
  return bounded(taskCommands(request));
}

export function taskIncludeSpecifiers(source: string): readonly string[] {
  assertRunnableConfigurationBytes(source);
  const document = Bun.YAML.parse(source) as ConfigurationNode;
  const includes = mapping(mapping(document).includes ?? false);
  return bounded(
    Object.values(includes).flatMap((value) => {
      if (typeof value === 'string') return [value];
      const taskfile = mapping(value).taskfile;
      return typeof taskfile === 'string' ? [taskfile] : [];
    }),
  );
}

export function assertRunnableConfigurationBytes(source: string): void {
  if (new TextEncoder().encode(source).byteLength > MAX_CONFIG_BYTES)
    throw new Error('Runnable configuration exceeds its UTF-8 byte bound.');
}

function bounded(commands: readonly string[]): readonly string[] {
  if (commands.length > MAX_COMMANDS)
    throw new Error('Runnable configuration command count exceeds its bound.');
  let bytes = 0;
  for (const command of commands) {
    bytes += new TextEncoder().encode(command).byteLength;
    if (bytes > MAX_COMMAND_BYTES)
      throw new Error(
        'Runnable configuration command bytes exceed their bound.',
      );
  }
  return commands;
}

function taskCommands(request: TaskCommandRequest): readonly string[] {
  const root = mapping(request.document);
  if (root.dotenv !== undefined)
    throw new Error('Task dotenv configuration is forbidden.');
  const commands: string[] = [];
  const rootShellRequest: ShellVariableCollectionRequest = {
    node: root,
    target: commands,
  };
  collectShellVariables(rootShellRequest);
  const rootVariableRequest: ResolvedTaskVariableRequest = {
    root,
    task: {},
    taskfileDirectory: posix.dirname(request.taskfilePath),
  };
  const rootValues = taskStaticVariables(rootVariableRequest);
  for (let index = 0; index < commands.length; index += 1) {
    const templateRequest: TaskTemplateRequest = {
      source: commands[index] ?? '',
      values: rootValues,
    };
    const shellRequest: TaskShellVariableRequest = {
      source: resolveTaskTemplate(templateRequest),
      values: rootValues,
    };
    commands[index] = resolveTaskShellVariables(shellRequest);
  }
  for (const task of Object.values(mapping(root.tasks ?? false))) {
    const node = mapping(task);
    if (node.dotenv !== undefined)
      throw new Error('Task dotenv configuration is forbidden.');
    const start = commands.length;
    const shellVariableRequest: ShellVariableCollectionRequest = {
      node,
      target: commands,
    };
    collectShellVariables(shellVariableRequest);
    for (const value of [node.cmds, node.status]) {
      const commandRequest: CommandCollectionRequest = {
        value: value ?? false,
        target: commands,
      };
      collectCommandList(commandRequest);
    }
    const dependencyRequest: CommandCollectionRequest = {
      value: node.deps ?? false,
      target: commands,
    };
    collectTaskDependencies(dependencyRequest);
    const shellRequest: CommandCollectionRequest = {
      value: node.preconditions ?? false,
      target: commands,
    };
    collectTaskShellList(shellRequest);
    for (const value of Object.values(mapping(node.vars ?? false))) {
      const shell = mapping(value).sh;
      if (typeof shell === 'string') commands.push(shell);
    }
    const variableRequest: ResolvedTaskVariableRequest = {
      root,
      task: node,
      taskfileDirectory: posix.dirname(request.taskfilePath),
    };
    const values = taskStaticVariables(variableRequest);
    const directoryRequest: TaskTemplateRequest = {
      source: typeof node.dir === 'string' ? node.dir : '',
      values,
    };
    const directory = resolveTaskTemplate(directoryRequest);
    const environmentRequest: TaskEnvironmentRequest = { root, task: node };
    const environment = taskEnvironment(environmentRequest);
    for (let index = start; index < commands.length; index += 1) {
      const templateRequest: TaskTemplateRequest = {
        source: commands[index] ?? '',
        values,
      };
      const shellVariableRequest: TaskShellVariableRequest = {
        source: resolveTaskTemplate(templateRequest),
        values,
      };
      const command = resolveTaskShellVariables(shellVariableRequest);
      const located = directory ? `cd "${directory}" && ${command}` : command;
      commands[index] = environment ? `${environment} ${located}` : located;
    }
  }
  return commands;
}

function collectShellVariables(request: ShellVariableCollectionRequest): void {
  for (const field of ['vars', 'env'] as const)
    for (const value of Object.values(mapping(request.node[field] ?? false))) {
      const shell = mapping(value).sh;
      if (typeof shell === 'string') request.target.push(shell);
    }
}

function taskEnvironment(request: TaskEnvironmentRequest): string {
  const values = new Map<string, string>();
  for (const environment of [
    mapping(request.root.env ?? false),
    mapping(request.task.env ?? false),
  ])
    for (const [name, value] of Object.entries(environment))
      if (/^[A-Za-z_]\w*$/u.test(name) && typeof value === 'string')
        values.set(name, value);
  return [...values]
    .map(([name, value]) => `${name}='${value.replaceAll("'", "'\\''")}'`)
    .join(' ');
}

function taskStaticVariables(
  request: ResolvedTaskVariableRequest,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>([
    ['APP_ROOT', 'nook-app'],
    ['DOCKER', 'docker'],
    ['DOCKER_MKCERT_IMAGE', 'nook-mkcert:local'],
    ['EXTENSION_ROOT', 'nook-app/nook-web/nook-web-extension'],
    ['PLATFORM_ROOT', 'nook-app/nook-platform'],
    ['REPO_ROOT', '.'],
    ['RESEARCH_ROOT', 'nook-app/nook-web/nook-web-research'],
    ['ROOT_DIR', '.'],
    ['TASKFILE_DIR', request.taskfileDirectory],
    ['WEB_GROUP_ROOT', 'nook-app/nook-web'],
    ['WEB_ROOT', 'nook-app/nook-web/nook-web-app'],
    ['WEB_SHARED_ROOT', 'nook-app/nook-web/nook-web-shared'],
  ]);
  for (const variables of [
    mapping(request.root.vars ?? false),
    mapping(request.task.vars ?? false),
  ])
    for (const [name, value] of Object.entries(variables)) {
      if (typeof value === 'string') values.set(name, value);
      const shell = mapping(value).sh;
      if (typeof shell !== 'string') continue;
      const suffix = /^cd "\{\{\.TASKFILE_DIR\}\}([^"]*)" && pwd$/u.exec(
        shell,
      )?.[1];
      if (typeof suffix === 'string')
        values.set(
          name,
          posix.normalize(`${request.taskfileDirectory}${suffix}`),
        );
    }
  for (let step = 0; step < 8; step += 1)
    for (const [name, value] of values) {
      const templateRequest: TaskTemplateRequest = { source: value, values };
      values.set(name, resolveTaskTemplate(templateRequest));
    }
  return values;
}

function resolveTaskTemplate(request: TaskTemplateRequest): string {
  return request.source
    .replace(/\{\{default "([^"]*)" \.([A-Za-z_]\w*)\}\}/gu, (template) => {
      const match = /^\{\{default "([^"]*)" \.([A-Za-z_]\w*)\}\}$/u.exec(
        template,
      );
      const fallback = match?.[1] ?? '';
      const name = match?.[2] ?? '';
      const value = request.values.get(name);
      return value && !value.includes('{{') ? value : fallback;
    })
    .replace(/\{\{\.([A-Za-z_]\w*)\}\}/gu, (template) => {
      const name = /^\{\{\.([A-Za-z_]\w*)\}\}$/u.exec(template)?.[1] ?? '';
      return request.values.get(name) ?? template;
    });
}

function resolveTaskShellVariables(request: TaskShellVariableRequest): string {
  let resolved = request.source;
  for (const [name, value] of request.values) {
    if (value.includes('{{')) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    resolved = resolved
      .replace(new RegExp(`\\$${escaped}(?![A-Za-z0-9_])`, 'gu'), value)
      .replaceAll(`\${${name}}`, value);
  }
  return resolved;
}

function collectCommandList(request: CommandCollectionRequest): void {
  if (!Array.isArray(request.value)) return;
  for (const entry of request.value) {
    if (typeof entry === 'string') request.target.push(entry);
    else {
      const command = mapping(entry);
      for (const field of ['cmd', 'sh'] as const)
        if (typeof command[field] === 'string')
          request.target.push(command[field]);
      if (typeof command.task === 'string')
        request.target.push(`task ${command.task}`);
      if (typeof command.defer === 'string') request.target.push(command.defer);
    }
  }
}

function collectTaskDependencies(request: CommandCollectionRequest): void {
  if (!Array.isArray(request.value)) return;
  for (const entry of request.value) {
    if (typeof entry === 'string') request.target.push(`task ${entry}`);
    else if (typeof mapping(entry).task === 'string')
      request.target.push(`task ${String(mapping(entry).task)}`);
  }
}

function collectTaskShellList(request: CommandCollectionRequest): void {
  if (!Array.isArray(request.value)) return;
  for (const entry of request.value) {
    if (typeof entry === 'string') {
      request.target.push(entry);
      continue;
    }
    const shell = mapping(entry).sh;
    if (typeof shell === 'string') request.target.push(shell);
  }
}

function mapping(
  value: ConfigurationNode,
): Readonly<Record<string, ConfigurationNode>> {
  return value instanceof Object && !Array.isArray(value)
    ? (value as Readonly<Record<string, ConfigurationNode>>)
    : {};
}
