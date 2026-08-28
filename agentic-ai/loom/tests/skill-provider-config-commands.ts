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

export function runnableCommandSources(
  inspection: RunnableCommandInspection,
): readonly string[] {
  assertRunnableConfigurationBytes(inspection.source);
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
  if (
    /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(inspection.path) ||
    /^\.task\//u.test(inspection.path)
  )
    return bounded(taskCommands(document));
  if (/^\.github\/workflows\//u.test(inspection.path)) {
    const request = { action: false, document };
    return bounded(workflowCommandSources(request));
  }
  if (/(^|\/)action\.ya?ml$/u.test(inspection.path)) {
    const request = { action: true, document };
    return bounded(workflowCommandSources(request));
  }
  return [];
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

function taskCommands(document: ConfigurationNode): readonly string[] {
  const root = mapping(document);
  const commands: string[] = [];
  for (const task of Object.values(mapping(root.tasks ?? false))) {
    const node = mapping(task);
    const start = commands.length;
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
    const variableRequest: TaskStaticVariableRequest = { root, task: node };
    const values = taskStaticVariables(variableRequest);
    const directoryRequest: TaskTemplateRequest = {
      source: typeof node.dir === 'string' ? node.dir : '',
      values,
    };
    const directory = resolveTaskTemplate(directoryRequest);
    for (let index = start; index < commands.length; index += 1) {
      const templateRequest: TaskTemplateRequest = {
        source: commands[index] ?? '',
        values,
      };
      const command = resolveTaskTemplate(templateRequest);
      commands[index] = directory ? `cd "${directory}" && ${command}` : command;
    }
  }
  return commands;
}

function taskStaticVariables(
  request: TaskStaticVariableRequest,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>([
    ['EXTENSION_ROOT', 'nook-app/nook-web/nook-web-extension'],
    ['REPO_ROOT', '.'],
    ['ROOT_DIR', '.'],
  ]);
  for (const variables of [
    mapping(request.root.vars ?? false),
    mapping(request.task.vars ?? false),
  ])
    for (const [name, value] of Object.entries(variables))
      if (typeof value === 'string') values.set(name, value);
  for (let step = 0; step < 8; step += 1)
    for (const [name, value] of values) {
      const templateRequest: TaskTemplateRequest = { source: value, values };
      values.set(name, resolveTaskTemplate(templateRequest));
    }
  return values;
}

function resolveTaskTemplate(request: TaskTemplateRequest): string {
  return request.source.replace(/\{\{\.([A-Za-z_]\w*)\}\}/gu, (template) => {
    const name = /^\{\{\.([A-Za-z_]\w*)\}\}$/u.exec(template)?.[1] ?? '';
    return request.values.get(name) ?? template;
  });
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
