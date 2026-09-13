import assert from 'node:assert/strict';
import { ok, type Result } from 'neverthrow';
import { type AgentExecutionFailure } from '../../src/agent-workflow/runtime.ts';
import { randomUUID } from 'node:crypto';

import { rm } from 'node:fs/promises';

import type { RmOptions } from 'node:fs';

import { join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

import {
  StructuralAssessmentKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  StructuralExpertAuthorizationKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';

import type {
  CodeRefactoringTaskOutput,
  StructuralExpertAuthorization,
  StructuralExpertPlanTaskOutput,
} from '../../src/agent-workflow/domain.ts';

import type {
  AgentExecutionCompletion,
  AgentTaskRuntime,
} from '../../src/agent-workflow/runtime.ts';

import { StructuralExpertParentAuthorization } from '../../src/structural-experts/parent-authorization.ts';

import type { VerifyStructuralParentAuthorizationRequest } from '../../src/structural-experts/parent-authorization.ts';

import type { StructuralEvidenceInvocationRequest } from '../../src/structural-experts/request-codec.ts';

import { StructuralExpertRuntimeAuthority } from '../../src/structural-experts/trusted-runtime.ts';

import type {
  ConsumeStructuralCompletionAuthorityRequest,
  ConsumeStructuralJournalAuthorityRequest,
  CreateStructuralRuntimeSessionRequest,
  StructuralCompletionAuthority,
  StructuralJournalAuthority,
  TrustedStructuralExecution,
} from '../../src/structural-experts/trusted-runtime.ts';

import { StructuralExpertKind } from '../../src/structural-experts/catalog.ts';

import { ModuleExpertsInvokeParentFixtureScenario } from '../module-experts/invoke-parent-fixture.ts';

import type { CreateCompletedAttemptArgs } from '../module-experts/invoke-parent-fixture.ts';

import { StructuralExpertsStructuralRuntimeMockScenario } from './structural-runtime-mock.ts';

import type { RegisterStructuralRuntimeMockRequest } from './structural-runtime-mock.ts';

export class StructuralExpertsTrustedRuntimeScenario {
  private constructor(
    private readonly request: StructuralEvidenceInvocationRequest,
  ) {}

  static structuralRequest(): StructuralEvidenceInvocationRequest {
    return {
      kind: StructuralExpertKind.RepositoryEvidence,
      runId: `structural-authority-${randomUUID()}`,
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
      instruction: 'Inspect bounded code.',
      evidencePaths: ['nook-app/nook-platform/nook-core'],
    };
  }

  static createParent(
    request: StructuralEvidenceInvocationRequest,
  ): Promise<void> {
    return new StructuralExpertsTrustedRuntimeScenario(request).execute();
  }

  private async execute(): Promise<void> {
    const request = this.request;
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
    const parentRequest: CreateCompletedAttemptArgs = {
      repoRoot: REPO_ROOT,
      runId: request.runId,
      sourceCommit: request.sourceCommit,
      task: request.parent.task,
      agent: request.parent.agent,
      attempt: request.parent.attempt,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      output,
    };
    await ModuleExpertsInvokeParentFixtureScenario.createCompletedAttempt(
      parentRequest,
    );
  }

  static codeEvidence(): CodeRefactoringTaskOutput {
    const evidence = ['Evidence recorded.'];
    return {
      resultKind: WorkflowResultKind.CodeRefactoringEvidence,
      summary: 'Code inspected.',
      materializedViewMarkdown: '# Code evidence\n\nInspected.',
      findings: [],
      notesForParent: [],
      artifacts: [],
      continuation: {
        scopeModules: evidence,
        acceptedExternalContracts: evidence,
        preservedBehaviorInvariants: evidence,
        preservedSecurityInvariants: evidence,
        architectureFindings:
          StructuralExpertsTrustedRuntimeScenario.noFindings(),
        designFindings: StructuralExpertsTrustedRuntimeScenario.noFindings(),
        codeQualityFindings:
          StructuralExpertsTrustedRuntimeScenario.noFindings(),
        typeSafetyFindings:
          StructuralExpertsTrustedRuntimeScenario.noFindings(),
        testFindings: StructuralExpertsTrustedRuntimeScenario.noFindings(),
        dependencyDirectionFindings:
          StructuralExpertsTrustedRuntimeScenario.noFindings(),
        proposedSlices: evidence,
        focusedValidation: evidence,
        risks: evidence,
        unresolvedDecisions: evidence,
        parentActions: evidence,
      },
    };
  }

  static processingRunDirectory(runId: string): string {
    return join(
      REPO_ROOT,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      runId,
    );
  }

  static noFindings() {
    return {
      kind: StructuralAssessmentKind.None,
      reason: 'The bounded assessment found no issue in this category.',
    } as const;
  }
}

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

class TrustedCompletionRuntime implements AgentTaskRuntime<string, string> {
  async executeAgent(): Promise<
    Result<AgentExecutionCompletion, AgentExecutionFailure>
  > {
    return ok({
      threadId: 'trusted-thread',
      output: StructuralExpertsTrustedRuntimeScenario.codeEvidence(),
    });
  }
}

test('binds structural journal and completion authorities exactly once', async () => {
  const request = StructuralExpertsTrustedRuntimeScenario.structuralRequest();
  const runDirectory =
    StructuralExpertsTrustedRuntimeScenario.processingRunDirectory(
      request.runId,
    );
  const registrationRequest: RegisterStructuralRuntimeMockRequest = {
    runId: request.runId,
    runtime: new TrustedCompletionRuntime(),
  };
  const registration =
    StructuralExpertsStructuralRuntimeMockScenario.registerStructuralRuntimeMock(
      registrationRequest,
    );
  try {
    await StructuralExpertsTrustedRuntimeScenario.createParent(request);
    const verificationRequest: VerifyStructuralParentAuthorizationRequest = {
      request,
      runDirectory,
    };
    const authorization =
      await StructuralExpertParentAuthorization.verifyStructuralParentAuthorization(
        verificationRequest,
      );
    const sessionRequest: CreateStructuralRuntimeSessionRequest = {
      repoRoot: REPO_ROOT,
      request,
      parentAuthorization: authorization,
    };
    const created =
      StructuralExpertRuntimeAuthority.createStructuralRuntimeSession(
        sessionRequest,
      );
    const reboundIdentity = { ...created.identity, task: 'rebound-task' };
    const forgedJournal: StructuralJournalAuthority = {
      // @ts-expect-error forged discriminator intentionally has the wrong kind
      kind: 'structural-expert-journal-authority',
    };
    const forgedJournalRequest: ConsumeStructuralJournalAuthorityRequest = {
      authority: forgedJournal,
      identity: created.identity,
    };
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralJournalAuthority(
        forgedJournalRequest,
      ),
    ).toThrow('journal authority is invalid');
    const reboundJournalRequest: ConsumeStructuralJournalAuthorityRequest = {
      authority: created.journalAuthority,
      identity: reboundIdentity,
    };
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralJournalAuthority(
        reboundJournalRequest,
      ),
    ).toThrow('journal authority is invalid');
    const journalRequest = {
      authority: created.journalAuthority,
      identity: created.identity,
    };
    const binding =
      StructuralExpertRuntimeAuthority.consumeStructuralJournalAuthority(
        journalRequest,
      );
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralJournalAuthority(
        journalRequest,
      ),
    ).toThrow('journal authority is invalid');
    const executionRequest = {
      session: created.session,
      signal: new AbortController().signal,
      observe: async () => {},
    };
    const executionPromise =
      StructuralExpertRuntimeAuthority.executeStructuralExpert(
        executionRequest,
      );
    const runtimeFailure1 =
      await StructuralExpertRuntimeAuthority.executeStructuralExpert(
        executionRequest,
      );
    assert(runtimeFailure1.isErr());
    expect(runtimeFailure1.error.message).toContain(
      'runtime session is invalid',
    );
    const executionResult = await executionPromise;
    assert(executionResult.isOk());
    const execution = executionResult.value;
    const forgedAuthority: StructuralCompletionAuthority = {
      // @ts-expect-error forged discriminator intentionally has the wrong kind
      kind: 'structural-expert-completion-authority',
    };
    const forgedExecution: TrustedStructuralExecution = {
      completion: execution.completion,
      authority: forgedAuthority,
    };
    const forgedCompletionRequest: ConsumeStructuralCompletionAuthorityRequest =
      {
        binding,
        execution: forgedExecution,
        terminalCompletion: forgedExecution.completion,
      };
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralCompletionAuthority(
        forgedCompletionRequest,
      ),
    ).toThrow('completion authority is invalid');
    const reboundCompletion = {
      ...execution.completion,
      threadId: 'rebound-thread',
    };
    const reboundCompletionRequest: ConsumeStructuralCompletionAuthorityRequest =
      {
        binding,
        execution,
        terminalCompletion: reboundCompletion,
      };
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralCompletionAuthority(
        reboundCompletionRequest,
      ),
    ).toThrow('completion authority is invalid');
    const completionRequest = {
      binding,
      execution,
      terminalCompletion: execution.completion,
    };
    StructuralExpertRuntimeAuthority.consumeStructuralCompletionAuthority(
      completionRequest,
    );
    expect(() =>
      StructuralExpertRuntimeAuthority.consumeStructuralCompletionAuthority(
        completionRequest,
      ),
    ).toThrow('completion authority is invalid');
  } finally {
    registration.dispose();
    await rm(runDirectory, REMOVE_RECURSIVELY);
  }
});
