import type {
  ConfigurationMapping,
  ConfigurationNode,
} from './skill-provider-command-types.ts';

type WorkflowCommandRequest = {
  readonly action: boolean;
  readonly document: ConfigurationNode;
};
type StepRunRequest = {
  readonly defaultDirectory: string;
  readonly defaultShell: string | false;
  readonly environment: ReadonlyMap<string, string>;
  readonly steps: ConfigurationNode;
  readonly target: string[];
};
type StaticEnvironmentRequest = {
  readonly inherited: ReadonlyMap<string, string> | false;
  readonly node: ConfigurationMapping;
};

const STANDARD_WORKFLOW_SHELLS = new Set(['bash', 'sh']);
const EXECUTION_ENVIRONMENT_NAMES = new Set(['BASH_ENV', 'NODE_OPTIONS']);

export function workflowCommandSources(
  request: WorkflowCommandRequest,
): readonly string[] {
  const root = mapping(request.document);
  const commands: string[] = [];
  if (request.action) {
    const runs = mapping(root.runs ?? false);
    if (runs.using === 'composite') {
      const environmentRequest: StaticEnvironmentRequest = {
        inherited: false,
        node: root,
      };
      const stepRequest: StepRunRequest = {
        defaultDirectory: '',
        defaultShell: workflowDefaultShell(root),
        environment: staticEnvironment(environmentRequest),
        steps: runs.steps ?? false,
        target: commands,
      };
      collectStepRuns(stepRequest);
    }
    return commands;
  }
  const workflowDirectory = defaultWorkingDirectory(root);
  const workflowShell = workflowDefaultShell(root);
  const workflowEnvironmentRequest: StaticEnvironmentRequest = {
    inherited: false,
    node: root,
  };
  const workflowEnvironment = staticEnvironment(workflowEnvironmentRequest);
  for (const job of Object.values(mapping(root.jobs ?? false))) {
    const jobNode = mapping(job);
    const jobDirectory = defaultWorkingDirectory(jobNode);
    const environmentRequest: StaticEnvironmentRequest = {
      inherited: workflowEnvironment,
      node: jobNode,
    };
    const stepRequest: StepRunRequest = {
      defaultDirectory: jobDirectory || workflowDirectory,
      defaultShell:
        workflowDefaultShell(jobNode) ||
        workflowShell ||
        workflowRunnerDefaultShell(jobNode),
      environment: staticEnvironment(environmentRequest),
      steps: jobNode.steps ?? false,
      target: commands,
    };
    collectStepRuns(stepRequest);
  }
  return commands;
}

export function workflowGithubScriptSources(
  request: WorkflowCommandRequest,
): readonly string[] {
  const root = mapping(request.document);
  if (request.action) {
    const runs = mapping(root.runs ?? false);
    return githubScriptSources(runs.steps ?? false);
  }
  return Object.values(mapping(root.jobs ?? false)).flatMap((job) =>
    githubScriptSources(mapping(job).steps ?? false),
  );
}

function githubScriptSources(steps: ConfigurationNode): readonly string[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => {
    const node = mapping(step);
    if (
      typeof node.uses !== 'string' ||
      !node.uses.startsWith('actions/github-script@')
    )
      return [];
    const source = mapping(node.with ?? false).script;
    if (typeof source !== 'string')
      throw new Error('github-script step has no static script body.');
    if (source.includes('${{'))
      throw new Error(
        'github-script body has an unresolved Actions expression.',
      );
    return [source];
  });
}

function collectStepRuns(request: StepRunRequest): void {
  if (!Array.isArray(request.steps)) return;
  for (const step of request.steps) {
    const node = mapping(step);
    if (typeof node.run !== 'string') continue;
    assertSafeWorkflowShell(node.shell ?? request.defaultShell);
    const directory =
      typeof node['working-directory'] === 'string'
        ? node['working-directory']
        : request.defaultDirectory;
    const environmentRequest: StaticEnvironmentRequest = {
      inherited: request.environment,
      node,
    };
    const environment = staticEnvironment(environmentRequest);
    if (environment.has('BASH_ENV'))
      throw new Error('BASH_ENV workflow shell startup is forbidden.');
    const prefix = [...environment]
      .map(([name, value]) => `${name}='${value.replaceAll("'", "'\\''")}'`)
      .join(' ');
    const command = directory
      ? `cd "${directory.replaceAll('"', '\\"')}" && ${node.run}`
      : node.run;
    request.target.push(prefix ? `${prefix} ${command}` : command);
  }
}

function assertSafeWorkflowShell(shell: ConfigurationNode | false): void {
  if (shell === false)
    throw new Error('Implicit workflow shell is not proven to be Bash or sh.');
  if (typeof shell !== 'string' || shell.includes('${{'))
    throw new Error('Dynamic workflow shell is forbidden.');
  if (!STANDARD_WORKFLOW_SHELLS.has(shell))
    throw new Error(`Custom workflow shell is forbidden: ${shell}`);
}

function workflowRunnerDefaultShell(
  node: ConfigurationMapping,
): string | false {
  const runner = node['runs-on'];
  if (typeof runner !== 'string' || /windows/iu.test(runner)) return false;
  if (/^(?:ubuntu-|macos-|nook-k0s)/u.test(runner)) return 'bash';
  return runner.includes('${{') &&
    (runner.includes('vars.NOOK_RUNS_ON') ||
      runner.includes('vars.NOOK_HIVE_RUNS_ON'))
    ? 'bash'
    : false;
}

function staticEnvironment(
  request: StaticEnvironmentRequest,
): ReadonlyMap<string, string> {
  const values = new Map(request.inherited || []);
  for (const [name, value] of Object.entries(
    mapping(request.node.env ?? false),
  ))
    if (
      /^[A-Za-z_]\w*$/u.test(name) &&
      typeof value === 'string' &&
      (!value.includes('${{') || EXECUTION_ENVIRONMENT_NAMES.has(name))
    )
      values.set(name, value);
  return values;
}

function defaultWorkingDirectory(node: ConfigurationMapping): string {
  const run = mapping(mapping(node.defaults ?? false).run ?? false);
  return typeof run['working-directory'] === 'string'
    ? run['working-directory']
    : '';
}

function workflowDefaultShell(node: ConfigurationMapping): string | false {
  const runDefaults = mapping(mapping(node.defaults ?? false).run ?? false);
  if (!('shell' in runDefaults)) return false;
  const shell = runDefaults.shell;
  assertSafeWorkflowShell(shell);
  return typeof shell === 'string' ? shell : false;
}

function mapping(value: ConfigurationNode): ConfigurationMapping {
  return value instanceof Object && !Array.isArray(value)
    ? (value as ConfigurationMapping)
    : {};
}
