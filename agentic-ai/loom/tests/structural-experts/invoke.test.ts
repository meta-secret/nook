import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import type {
  AgentExecutionCompletion,
  AgentExecutionInvocation,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';
import {
  StructuralAssessmentKind,
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  StructuralExpertAuthorizationKind,
  StructuralFindingCategory,
  StructuralFindingDisposition,
  StructuralFindingSeverity,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type {
  CodeRefactoringTaskOutput,
  FailedTaskTerminal,
  StructuralExpertAuthorization,
  StructuralExpertPlanTaskOutput,
} from '../../src/agent-workflow/domain.ts';
import { AgentAttemptEventKind } from '../../src/agent-workflow/agent-events.ts';
import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';
import { invokeStructuralExpert } from '../../src/structural-experts/invoke.ts';
import type { InvokeStructuralExpertRequest } from '../../src/structural-experts/invoke.ts';
import { StructuralExpertKind } from '../../src/structural-experts/catalog.ts';
import type { StructuralEvidenceInvocationRequest } from '../../src/structural-experts/request-codec.ts';
import { createCompletedAttempt } from '../module-experts/invoke-parent-fixture.ts';
import { registerStructuralRuntimeMock } from './structural-runtime-mock.ts';
import type { RegisterStructuralRuntimeMockRequest } from './structural-runtime-mock.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const TRACKED_SOURCE_COMMIT = currentSourceCommit();
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

class ValidRuntime implements AgentTaskRuntime<string, string> {
  executionCount = 0;
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    this.executionCount += 1;
    void invocation;
    return {
      threadId: 'structural-thread',
      output: codeEvidence(),
    };
  }
}

class InvalidCompletionRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(
    invocation: AgentExecutionInvocation<string, string>,
  ): Promise<AgentExecutionCompletion> {
    void invocation;
    return {
      threadId: '',
      output: codeEvidence(),
    };
  }
}

class OutOfScopeEvidenceRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<AgentExecutionCompletion> {
    return {
      threadId: 'out-of-scope-thread',
      output: outOfScopeCodeEvidence(),
    };
  }
}

test('records completed structural evidence only through structural provenance', async () => {
  const request = invocationRequest('structural-success');
  const runDirectory = processingRunDirectory(request.runId);
  try {
    const runtime = new ValidRuntime();
    const input: RunInvocationRequest = { request, runtime };
    const result = await runInvocation(input);
    expect(runtime.executionCount).toBe(1);
    expect(result.terminal.kind).toBe(TaskTerminalKind.Completed);
    const readRequest: ReadEventsRequest = {
      runDirectory: result.runDirectory,
      request,
    };
    const events = await readEvents(readRequest);
    expect(events[0]?.adapter).toBe(
      AgentAttemptAdapterKind.StructuralExpertInvocation,
    );
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('invalid completion becomes a replayable sanitized failed terminal', async () => {
  const request = invocationRequest('structural-invalid-completion');
  const runDirectory = processingRunDirectory(request.runId);
  try {
    const input: RunInvocationRequest = {
      request,
      runtime: new InvalidCompletionRuntime(),
    };
    const result = await runInvocation(input);
    const expectedTerminal: FailedTaskTerminal<string> = {
      kind: TaskTerminalKind.Failed,
      task: request.task,
      attempt: request.attempt,
      summary: 'Structural expert runtime failed.',
    };
    expect(result.terminal).toEqual(expectedTerminal);
    const readRequest: ReadEventsRequest = {
      runDirectory: result.runDirectory,
      request,
    };
    const events = await readEvents(readRequest);
    expect(events.at(-1)?.kind).toBe(
      AgentAttemptEventKind.AttemptTerminalRecorded,
    );
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

test('out-of-snapshot evidence becomes a replayable sanitized failed terminal', async () => {
  const base = invocationRequest('structural-out-of-scope-evidence');
  const request: StructuralEvidenceInvocationRequest = {
    ...base,
    sourceCommit: TRACKED_SOURCE_COMMIT,
    evidencePaths: ['Taskfile.yml'],
  };
  const runDirectory = processingRunDirectory(request.runId);
  try {
    const input: RunInvocationRequest = {
      request,
      runtime: new OutOfScopeEvidenceRuntime(),
    };
    const result = await runInvocation(input);
    expect(result.terminal.kind).toBe(TaskTerminalKind.Failed);
    if (result.terminal.kind !== TaskTerminalKind.Failed) {
      throw new Error('Expected the invocation to fail closed.');
    }
    expect(result.terminal.summary).toBe('Structural expert runtime failed.');
  } finally {
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});

type RunInvocationRequest = {
  readonly request: StructuralEvidenceInvocationRequest;
  readonly runtime: AgentTaskRuntime<string, string>;
};

async function runInvocation(input: RunInvocationRequest) {
  const registrationRequest: RegisterStructuralRuntimeMockRequest = {
    runId: input.request.runId,
    runtime: input.runtime,
  };
  const registration = registerStructuralRuntimeMock(registrationRequest);
  try {
    await createParent(input.request);
    const invocation: InvokeStructuralExpertRequest = {
      repoRoot: REPO_ROOT,
      request: input.request,
      signal: new AbortController().signal,
    };
    return await invokeStructuralExpert(invocation);
  } finally {
    registration.dispose();
  }
}

async function createParent(
  request: StructuralEvidenceInvocationRequest,
): Promise<void> {
  const authorization: StructuralExpertAuthorization = {
    kind: StructuralExpertAuthorizationKind.RepositoryEvidence,
    task: request.task,
    expert: request.expert,
    attempt: request.attempt,
    depth: 2,
    parent: request.parent,
    evidencePaths: request.evidencePaths,
  };
  const output: StructuralExpertPlanTaskOutput = {
    resultKind: WorkflowResultKind.StructuralExpertPlan,
    summary: 'Structural plan approved.',
    materializedViewMarkdown: '# Structural plan\n\nApproved.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    structuralExpertAuthorizations: [authorization],
  };
  const parentRequest = {
    repoRoot: REPO_ROOT,
    runId: request.runId,
    sourceCommit: request.sourceCommit,
    task: request.parent.task,
    agent: request.parent.agent,
    attempt: request.parent.attempt,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot } as const,
    output,
  };
  await createCompletedAttempt(parentRequest);
}

function invocationRequest(
  prefix: string,
): StructuralEvidenceInvocationRequest {
  return {
    kind: StructuralExpertKind.RepositoryEvidence,
    runId: `${prefix}-${randomUUID()}`,
    expert: 'code_refactoring_expert',
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect-code',
    attempt: 1,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'plan-refactoring',
      agent: 'delivery-owner',
      attempt: 1,
    },
    instruction: 'Inspect bounded code structure.',
    evidencePaths: ['nook-app/nook-platform/nook-core'],
  };
}

function codeEvidence(): CodeRefactoringTaskOutput {
  const item = ['Evidence recorded.'];
  return {
    resultKind: WorkflowResultKind.CodeRefactoringEvidence,
    summary: 'Code inspected.',
    materializedViewMarkdown: '# Code evidence\n\nInspected.',
    findings: [],
    notesForParent: [],
    artifacts: [],
    continuation: {
      scopeModules: item,
      acceptedExternalContracts: item,
      preservedBehaviorInvariants: item,
      preservedSecurityInvariants: item,
      architectureFindings: noFindings(),
      designFindings: noFindings(),
      codeQualityFindings: noFindings(),
      typeSafetyFindings: noFindings(),
      testFindings: noFindings(),
      dependencyDirectionFindings: noFindings(),
      proposedSlices: item,
      focusedValidation: item,
      risks: item,
      unresolvedDecisions: item,
      parentActions: item,
    },
  };
}

function outOfScopeCodeEvidence(): CodeRefactoringTaskOutput {
  const output = codeEvidence();
  return {
    ...output,
    continuation: {
      ...output.continuation,
      architectureFindings: {
        kind: StructuralAssessmentKind.Findings,
        findings: [
          {
            findingId: 'outside-snapshot',
            category: StructuralFindingCategory.Architecture,
            severity: StructuralFindingSeverity.High,
            disposition: StructuralFindingDisposition.Investigate,
            summary: 'The cited evidence was outside the snapshot.',
            evidence: [
              {
                path: 'Cargo.toml',
                locator: 'workspace',
                observation: 'This file was not selected.',
              },
            ],
            affectedPaths: ['future/proposed/module.ts'],
            currentOwner: 'workspace',
            proposedOwner: 'delivery-owner',
            preservedInvariants: ['Do not mint unsupported evidence.'],
            validation: ['loom:verify'],
            unresolvedDecision: 'No unresolved decision.',
          },
        ],
      },
    },
  };
}

type ReadEventsRequest = {
  readonly runDirectory: string;
  readonly request: StructuralEvidenceInvocationRequest;
};

async function readEvents(
  input: ReadEventsRequest,
): Promise<readonly AgentAttemptEvent[]> {
  const path = join(
    input.runDirectory,
    'agents',
    input.request.task,
    `attempt-${input.request.attempt}`,
    'events.jsonl',
  );
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as AgentAttemptEvent);
}

function processingRunDirectory(runId: string): string {
  return join(
    REPO_ROOT,
    'workflow',
    'processing',
    DelegatedAgentWorkflowName.AgentWork,
    runId,
  );
}
function noFindings() {
  return {
    kind: StructuralAssessmentKind.None,
    reason: 'The bounded assessment found no issue in this category.',
  } as const;
}

function currentSourceCommit(): string {
  const options = { cwd: REPO_ROOT, encoding: 'utf8' as const };
  return execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
}
