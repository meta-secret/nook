import { composeTeamTaskContextPaths } from '../team-agents/context.ts';
import type {
  TeamTaskContext,
  TeamTaskContextPathRequest,
} from '../team-agents/context.ts';
import { ModuleDeliveryTaskKind } from './domain.ts';
import { runModuleDeliveryGit } from './git-command.ts';
import type { GitCommandRequest } from './git-command.ts';
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
  const contextRequest: TeamTaskContextPathRequest = {
    team: request.node.team,
    writeClaims: request.resources.write,
    selectedSkillPaths: request.node.cortexAuthoring.selectedSkillPaths,
  };
  const context = composeTeamTaskContextPaths(contextRequest);
  for (const path of context.contextPaths) {
    const command: GitCommandRequest = {
      args: ['ls-tree', request.startingFrontier, '--', path],
      cwd: request.repositoryRoot,
      allowFailure: true,
    };
    const result = runModuleDeliveryGit(command);
    const stdout = result.stdout.toString('utf8');
    if (
      result.exitCode !== 0 ||
      !/^100(?:644|755) blob /u.test(stdout) ||
      !stdout.endsWith(`\t${path}\n`)
    )
      throw new Error(
        `Cortex authoring context is not a committed regular file: ${path}.`,
      );
  }
  return context;
}
