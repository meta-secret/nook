import { expect, test } from 'bun:test';
import {
  AgentAttemptTransport,
  AgentAttemptDecodeError,
} from '../src/agent-workflow/attempt-codec.ts';
import {
  AgentAttemptEventKind,
  type AgentAttemptStartedEvent,
} from '../src/agent-workflow/agent-events.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  type FailedTaskTerminal,
} from '../src/agent-workflow/domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../src/agent-workflow/agent-attempt-version.ts';

const terminal: FailedTaskTerminal<string> = {
  kind: TaskTerminalKind.Failed,
  task: 'worker',
  attempt: 1,
  summary: 'Provider unavailable.',
};
const started: AgentAttemptStartedEvent = {
  kind: AgentAttemptEventKind.AttemptStarted,
  adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
  runId: 'run',
  workflow: DelegatedAgentWorkflowName.AgentWork,
  workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
  sourceCommit: 'a'.repeat(40),
  task: 'worker',
  agent: 'agent',
  attempt: 1,
  depth: 0,
  parent: { kind: AgentAttemptParentKind.WorkflowRoot },
  sequence: 1,
  actionId: 'action',
  occurredAt: '2026-09-09T00:00:00.000Z',
};

test('decodes concrete terminal and journal variants without retaining transport fields', () => {
  expect(
    AgentAttemptTransport.decodeTerminal(JSON.stringify(terminal)),
  ).toEqual(terminal);
  expect(
    AgentAttemptTransport.decodeEvents(`${JSON.stringify(started)}\n`),
  ).toEqual([started]);
});

test('rejects terminal variants with missing or mismatched payloads', () => {
  for (const payload of [
    [],
    { ...terminal, summary: 42 },
    { ...terminal, kind: 'future' },
    { ...terminal, output: {} },
    { ...terminal, attempt: '1' },
  ]) {
    expect(() =>
      AgentAttemptTransport.decodeTerminal(JSON.stringify(payload)),
    ).toThrow(AgentAttemptDecodeError);
  }
});

test('rejects malformed nested journal metadata before replay', () => {
  for (const payload of [
    { ...started, parent: [] },
    { ...started, parent: { kind: AgentAttemptParentKind.AgentAttempt } },
    { ...started, depth: '0' },
    { ...started, adapter: 'future' },
    { ...started, unexpected: true },
  ]) {
    expect(() =>
      AgentAttemptTransport.decodeEvent(JSON.stringify(payload)),
    ).toThrow(AgentAttemptDecodeError);
  }
});
