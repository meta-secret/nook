import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';
import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from '../../src/agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';

test('rejects direct construction of structural provenance without authority', () => {
  const configuration: AgentAttemptJournalConfiguration = {
    adapter:
      AgentAttemptAdapterKind.StructuralExpertInvocation as AgentAttemptAdapterKind.GenericDelegationRecorder,
    runDirectory: resolve(import.meta.dir, 'not-created'),
    runId: 'forged-structural-run',
    workflow: DelegatedAgentWorkflowName.AgentWork,
    workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    task: 'forged-structural-task',
    agent: 'code_refactoring_expert',
    attempt: 1,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'plan-refactoring',
      agent: 'delivery-owner',
      attempt: 1,
    },
    now: () => new Date().toISOString(),
  };
  expect(() => new AgentAttemptJournal(configuration)).toThrow(
    'require runtime completion authority',
  );
});
