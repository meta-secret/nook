import { runCommand } from '../lib/run.ts';
import type { RunCommandArgs } from '../lib/run.ts';
import { resolveTeamTaskContext } from '../team-agents/context.ts';
import type {
  TeamTaskContext,
  TeamTaskContextRequest,
} from '../team-agents/context.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryResourceClaims,
} from './domain.ts';

export type AdmitCortexAuthoringContextRequest = {
  readonly repositoryRoot: string;
  readonly startingFrontier: string;
  readonly node: ModuleDeliveryNodeV2;
  readonly resources: ModuleDeliveryResourceClaims;
};

export function admitCortexAuthoringContext(
  request: AdmitCortexAuthoringContextRequest,
): TeamTaskContext {
  if (
    request.node.kind !== ModuleDeliveryTaskKind.Write ||
    !request.node.cortexAuthoring
  )
    throw new Error('Cortex authoring context requires a write task.');
  const contextRequest: TeamTaskContextRequest = {
    repositoryRoot: request.repositoryRoot,
    team: request.node.team,
    readClaims: request.resources.read,
    writeClaims: request.resources.write,
    selectedSkillPaths: request.node.cortexAuthoring.selectedSkillPaths,
  };
  const context = resolveTeamTaskContext(contextRequest);
  for (const path of context.contextPaths) {
    const command: RunCommandArgs = {
      command: 'git',
      args: ['ls-tree', request.startingFrontier, '--', path],
      cwd: request.repositoryRoot,
    };
    const result = runCommand(command);
    if (
      result.exitCode !== 0 ||
      !/^100(?:644|755) blob /u.test(result.stdout) ||
      !result.stdout.endsWith(`\t${path}\n`)
    )
      throw new Error(
        `Cortex authoring context is not a committed regular file: ${path}.`,
      );
  }
  return context;
}
