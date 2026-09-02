import type { WorkflowVersion } from './domain.ts';

export const CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION: WorkflowVersion = '4.0.0';
export const PERSISTED_ACTIVITY_AGENT_ATTEMPT_WORKFLOW_VERSION: WorkflowVersion =
  '3.0.0';
export const PROVENANCE_AGENT_ATTEMPT_WORKFLOW_VERSION: WorkflowVersion =
  '2.0.0';
export const LEGACY_AGENT_ATTEMPT_WORKFLOW_VERSION: WorkflowVersion = '1.0.0';

export class AgentAttemptSchemaCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentAttemptSchemaCompatibilityError';
  }
}

export function assertCurrentAgentAttemptWorkflowVersion(
  version: WorkflowVersion,
): void {
  if (version === CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION) return;
  if (version === LEGACY_AGENT_ATTEMPT_WORKFLOW_VERSION) {
    throw new AgentAttemptSchemaCompatibilityError(
      'Agent attempt journal version 1.0.0 is legacy and cannot establish adapter provenance. Remove or explicitly migrate the persisted attempt before retrying.',
    );
  }
  if (version === PROVENANCE_AGENT_ATTEMPT_WORKFLOW_VERSION) {
    throw new AgentAttemptSchemaCompatibilityError(
      'Agent attempt journal version 2.0.0 predates compact action identities. Remove or explicitly migrate the persisted attempt before retrying.',
    );
  }
  if (version === PERSISTED_ACTIVITY_AGENT_ATTEMPT_WORKFLOW_VERSION) {
    throw new AgentAttemptSchemaCompatibilityError(
      'Agent attempt journal version 3.0.0 may contain persisted runtime activity. Remove and recreate the persisted attempt before retrying.',
    );
  }
  throw new AgentAttemptSchemaCompatibilityError(
    'Agent attempt journal version is unsupported. Remove or explicitly migrate the persisted attempt before retrying.',
  );
}
