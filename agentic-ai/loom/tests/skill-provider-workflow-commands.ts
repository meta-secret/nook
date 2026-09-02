import type {
  ConfigurationMapping,
  ConfigurationNode,
} from './skill-provider-command-types.ts';
import { tokenizeShell } from './skill-provider-shell-tokenizer.ts';

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
    const [runsNode = false] = [root.runs];
    const runs = mapping(runsNode);
    if (runs.using === 'composite') {
      const environmentRequest: StaticEnvironmentRequest = {
        inherited: false,
        node: root,
      };
      const [steps = false] = [runs.steps];
      const stepRequest: StepRunRequest = {
        defaultDirectory: '',
        defaultShell: workflowDefaultShell(root),
        environment: staticEnvironment(environmentRequest),
        steps,
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
  const [jobs = false] = [root.jobs];
  for (const job of Object.values(mapping(jobs))) {
    const jobNode = mapping(job);
    const jobDirectory = defaultWorkingDirectory(jobNode);
    const environmentRequest: StaticEnvironmentRequest = {
      inherited: workflowEnvironment,
      node: jobNode,
    };
    const [steps = false] = [jobNode.steps];
    const stepRequest: StepRunRequest = {
      defaultDirectory: jobDirectory || workflowDirectory,
      defaultShell:
        workflowDefaultShell(jobNode) ||
        workflowShell ||
        workflowRunnerDefaultShell(jobNode),
      environment: staticEnvironment(environmentRequest),
      steps,
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
    const [runsNode = false] = [root.runs];
    const runs = mapping(runsNode);
    const [steps = false] = [runs.steps];
    return githubScriptSources(steps);
  }
  const [jobs = false] = [root.jobs];
  return Object.values(mapping(jobs)).flatMap((job) => {
    const [steps = false] = [mapping(job).steps];
    return githubScriptSources(steps);
  });
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
    const [withNode = false] = [node.with];
    const source = mapping(withNode).script;
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
    const [defaulted10 = request.defaultShell] = [node.shell];
    assertSafeWorkflowShell(defaulted10);
    assertNoProtectedCommandFileMutation(node.run);
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

function assertNoProtectedCommandFileMutation(source: string): void {
  const words = tokenizeShell(source).filter(
    (token) => typeof token !== 'string',
  );
  if (
    !words.some(
      (word) => word.value === '$GITHUB_ENV' || word.value === '${GITHUB_ENV}',
    )
  )
    return;
  for (const name of EXECUTION_ENVIRONMENT_NAMES)
    if (
      words.some(
        (word) =>
          !word.dynamic &&
          (word.value.startsWith(`${name}=`) ||
            word.value.startsWith(`${name}<<`)),
      )
    )
      throw new Error(`${name} workflow command-file mutation is forbidden.`);
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
  const [environment = false] = [request.node.env];
  for (const [name, value] of Object.entries(mapping(environment)))
    if (
      /^[A-Za-z_]\w*$/u.test(name) &&
      typeof value === 'string' &&
      (!value.includes('${{') || EXECUTION_ENVIRONMENT_NAMES.has(name))
    )
      values.set(name, value);
  return values;
}

function defaultWorkingDirectory(node: ConfigurationMapping): string {
  const [defaults = false] = [node.defaults];
  const [runNode = false] = [mapping(defaults).run];
  const run = mapping(runNode);
  return typeof run['working-directory'] === 'string'
    ? run['working-directory']
    : '';
}

function workflowDefaultShell(node: ConfigurationMapping): string | false {
  const [defaults = false] = [node.defaults];
  const [runNode = false] = [mapping(defaults).run];
  const runDefaults = mapping(runNode);
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
