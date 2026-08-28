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
  readonly steps: ConfigurationNode;
  readonly target: string[];
};

export function workflowCommandSources(
  request: WorkflowCommandRequest,
): readonly string[] {
  const root = mapping(request.document);
  const commands: string[] = [];
  if (request.action) {
    const runs = mapping(root.runs ?? false);
    if (runs.using === 'composite') {
      const stepRequest: StepRunRequest = {
        defaultDirectory: '',
        steps: runs.steps ?? false,
        target: commands,
      };
      collectStepRuns(stepRequest);
    }
    return commands;
  }
  const workflowDirectory = defaultWorkingDirectory(root);
  for (const job of Object.values(mapping(root.jobs ?? false))) {
    const jobNode = mapping(job);
    const jobDirectory = defaultWorkingDirectory(jobNode);
    const stepRequest: StepRunRequest = {
      defaultDirectory: jobDirectory || workflowDirectory,
      steps: jobNode.steps ?? false,
      target: commands,
    };
    collectStepRuns(stepRequest);
  }
  return commands;
}

function collectStepRuns(request: StepRunRequest): void {
  if (!Array.isArray(request.steps)) return;
  for (const step of request.steps) {
    const node = mapping(step);
    if (typeof node.run !== 'string') continue;
    const directory =
      typeof node['working-directory'] === 'string'
        ? node['working-directory']
        : request.defaultDirectory;
    request.target.push(
      directory
        ? `cd "${directory.replaceAll('"', '\\"')}" && ${node.run}`
        : node.run,
    );
  }
}

function defaultWorkingDirectory(node: ConfigurationMapping): string {
  const run = mapping(mapping(node.defaults ?? false).run ?? false);
  return typeof run['working-directory'] === 'string'
    ? run['working-directory']
    : '';
}

function mapping(value: ConfigurationNode): ConfigurationMapping {
  return value instanceof Object && !Array.isArray(value)
    ? (value as ConfigurationMapping)
    : {};
}
