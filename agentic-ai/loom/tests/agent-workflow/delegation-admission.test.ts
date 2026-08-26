import { afterEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from '../../src/agent-workflow/domain.ts';
import type { TaskTerminal } from '../../src/agent-workflow/domain.ts';
import { AgentAttemptJournal } from '../../src/agent-workflow/agent-journal.ts';
import type { AgentAttemptJournalConfiguration } from '../../src/agent-workflow/agent-journal.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from '../../src/agent-workflow/agent-attempt-version.ts';
import {
  DELEGATION_PLAN_SCHEMA_VERSION,
  DelegationBarrierPolicy,
  DelegationRunEventKind,
  validateDelegationPlan,
} from '../../src/agent-workflow/delegation-domain.ts';
import type {
  DelegationAttemptDeclaration,
  DelegationAdmissionRequest,
  DelegationAttemptIdentity,
  DelegationPlan,
} from '../../src/agent-workflow/delegation-domain.ts';
import {
  decodeDelegationPlan,
  decodeDelegationRunEvent,
} from '../../src/agent-workflow/delegation-codec.ts';
import {
  admitDelegationAttempt,
  loadDelegationPlan,
  requireDelegationAttemptAdmission,
  startDelegationRun,
} from '../../src/agent-workflow/delegation-run-journal.ts';
import type {
  AdmitDelegationAttemptInput,
  LoadDelegationPlanInput,
  StartDelegationRunInput,
} from '../../src/agent-workflow/delegation-run-journal.ts';

const REMOVE_DIRECTORY_OPTIONS: {
  readonly recursive: true;
  readonly force: true;
} = {
  recursive: true,
  force: true,
};
const SOURCE_COMMIT = 'a'.repeat(40);
const RUN_ID = 'ordinary-delegation-test';
const ROOT: DelegationAttemptIdentity = {
  task: 'root-materializer',
  agent: 'synthesis-agent',
  attempt: 1,
};
const EXPERT: DelegationAttemptIdentity = {
  task: 'module-expert',
  agent: 'core-expert',
  attempt: 1,
};
const SPECIALIST: DelegationAttemptIdentity = {
  task: 'specialist',
  agent: 'security-expert',
  attempt: 1,
};

let temporaryDirectory: string | false = false;

afterEach(async () => {
  if (temporaryDirectory)
    await rm(temporaryDirectory, REMOVE_DIRECTORY_OPTIONS);
  temporaryDirectory = false;
});

describe('ordinary delegation admission', () => {
  test('decodes a bounded three-tier plan with exact all-terminal barriers', () => {
    const plan = validPlan();
    const decoded = decodeDelegationPlan(JSON.stringify(plan));
    expect(decoded).toEqual(plan);
    expect(decoded.attempts).toHaveLength(3);
  });

  test('rejects a barrier that omits a declared direct child', () => {
    const plan = validPlan();
    const root = plan.attempts[0];
    if (!root) throw new Error('Test plan root is missing.');
    const invalidRoot: DelegationAttemptDeclaration = {
      ...root,
      terminalBarrier: {
        policy: DelegationBarrierPolicy.AllTerminal,
        attempts: [],
      },
    };
    const invalidPlan: DelegationPlan = {
      ...plan,
      attempts: [invalidRoot, ...plan.attempts.slice(1)],
    };
    expect(() => validateDelegationPlan(invalidPlan)).toThrow(
      'must name exactly the direct children',
    );
  });

  test('rejects a second depth-one materializer', () => {
    const plan = validPlan();
    const extraRoot: DelegationAttemptDeclaration = {
      identity: { task: 'other-root', agent: 'other-agent', attempt: 1 },
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      terminalBarrier: {
        policy: DelegationBarrierPolicy.AllTerminal,
        attempts: [],
      },
    };
    const invalidPlan: DelegationPlan = {
      ...plan,
      attempts: [...plan.attempts, extraRoot],
    };
    expect(() => validateDelegationPlan(invalidPlan)).toThrow(
      'exactly one depth-1 root materializer',
    );
  });

  test('rejects excessive attempt count and hierarchy depth', () => {
    const plan = validPlan();
    const root = plan.attempts[0];
    const specialist = plan.attempts[2];
    if (!root || !specialist) throw new Error('Test plan is incomplete.');
    const excessiveAttempts: DelegationPlan = {
      ...plan,
      attempts: Array(17).fill(root) as readonly DelegationAttemptDeclaration[],
    };
    expect(() => validateDelegationPlan(excessiveAttempts)).toThrow(
      'between 1 and 16 attempts',
    );
    const excessiveDepth: DelegationAttemptDeclaration = {
      ...specialist,
      depth: 4,
    };
    const excessiveDepthPlan: DelegationPlan = {
      ...plan,
      attempts: [...plan.attempts.slice(0, 2), excessiveDepth],
    };
    expect(() => validateDelegationPlan(excessiveDepthPlan)).toThrow(
      'integer from 1 through 3',
    );
  });

  test('persists a hash-bound plan and admits only predeclared lineage order', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'nook-delegation-'));
    const plan = validPlan();
    const startInput: StartDelegationRunInput = {
      workingDirectory: temporaryDirectory,
      plan,
    };
    const started = await startDelegationRun(startInput);
    const loadInput: LoadDelegationPlanInput = {
      workingDirectory: temporaryDirectory,
      runId: plan.runId,
    };
    const loaded = await loadDelegationPlan(loadInput);
    expect(loaded.planSha256).toBe(started.planSha256);

    const expertInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: admissionRequest(plan.attempts[1]!),
    };
    await expect(admitDelegationAttempt(expertInput)).rejects.toThrow(
      'parent must be admitted first',
    );

    const wrongSourceRequest: DelegationAdmissionRequest = {
      ...admissionRequest(plan.attempts[0]!),
      sourceCommit: 'b'.repeat(40),
    };
    const wrongSourceInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: wrongSourceRequest,
    };
    await expect(admitDelegationAttempt(wrongSourceInput)).rejects.toThrow(
      'does not match the immutable plan declaration',
    );

    const wrongRootRequest: DelegationAdmissionRequest = {
      runId: RUN_ID,
      sourceCommit: SOURCE_COMMIT,
      identity: ROOT,
      depth: 2,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const wrongRootInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: wrongRootRequest,
    };
    await expect(admitDelegationAttempt(wrongRootInput)).rejects.toThrow(
      'does not match the immutable plan declaration',
    );

    const rootInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: admissionRequest(plan.attempts[0]!),
    };
    await admitDelegationAttempt(rootInput);
    await expect(
      requireDelegationAttemptAdmission(expertInput),
    ).rejects.toThrow('has not been admitted before dispatch');
    await admitDelegationAttempt(expertInput);
    const expectedExpertAdmission = { declaration: plan.attempts[1] };
    await expect(
      requireDelegationAttemptAdmission(expertInput),
    ).resolves.toMatchObject(expectedExpertAdmission);
    const specialistInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: admissionRequest(plan.attempts[2]!),
    };
    await expect(admitDelegationAttempt(specialistInput)).rejects.toThrow(
      'parent authorization failed',
    );
    const expertDeclaration = plan.attempts[1];
    if (!expertDeclaration) throw new Error('Expert declaration is missing.');
    const journalConfiguration: AgentAttemptJournalConfiguration = {
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      runDirectory: started.runDirectory,
      runId: plan.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: plan.sourceCommit,
      task: expertDeclaration.identity.task,
      agent: expertDeclaration.identity.agent,
      attempt: expertDeclaration.identity.attempt,
      depth: expertDeclaration.depth,
      parent: expertDeclaration.parent,
      now: () => new Date().toISOString(),
    };
    const journal = new AgentAttemptJournal<string>(journalConfiguration);
    await journal.initialize();
    const expertTerminal: TaskTerminal<string> = {
      kind: TaskTerminalKind.Completed,
      task: expertDeclaration.identity.task,
      attempt: expertDeclaration.identity.attempt,
      threadId: 'expert-thread',
      output: {
        resultKind: WorkflowResultKind.CortexEvidence,
        summary: 'Expert completed.',
        materializedViewMarkdown: '# Expert view\n\nCompleted.',
        findings: [],
        notesForParent: [],
        artifacts: [],
      },
    };
    await journal.finalize(expertTerminal);
    const firstSpecialistAdmission =
      await admitDelegationAttempt(specialistInput);
    const repeatedSpecialistAdmission =
      await admitDelegationAttempt(specialistInput);
    expect(repeatedSpecialistAdmission.event).toEqual(
      firstSpecialistAdmission.event,
    );

    const serialized = await readFile(started.eventsPath, 'utf8');
    const events = serialized.trim().split('\n').map(decodeDelegationRunEvent);
    expect(events.map((event) => event.kind)).toEqual([
      DelegationRunEventKind.PlanDeclared,
      DelegationRunEventKind.AttemptAdmitted,
      DelegationRunEventKind.AttemptAdmitted,
      DelegationRunEventKind.AttemptAdmitted,
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  test('detects plan.json mutation before another admission', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'nook-delegation-'));
    const plan = validPlan();
    const startInput: StartDelegationRunInput = {
      workingDirectory: temporaryDirectory,
      plan,
    };
    const started = await startDelegationRun(startInput);
    await appendFile(started.planPath, ' ', 'utf8');
    const loadInput: LoadDelegationPlanInput = {
      workingDirectory: temporaryDirectory,
      runId: plan.runId,
    };
    await expect(loadDelegationPlan(loadInput)).rejects.toThrow(
      'event identity or sequence is invalid',
    );
  });

  test('rejects undeclared or mismatched admission without appending events', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'nook-delegation-'));
    const plan = validPlan();
    const startInput: StartDelegationRunInput = {
      workingDirectory: temporaryDirectory,
      plan,
    };
    const started = await startDelegationRun(startInput);
    const loadInput: LoadDelegationPlanInput = {
      workingDirectory: temporaryDirectory,
      runId: plan.runId,
    };
    const root = plan.attempts[0];
    const expert = plan.attempts[1];
    if (!root || !expert) throw new Error('Test plan is incomplete.');
    const rootInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: admissionRequest(root),
    };
    await admitDelegationAttempt(rootInput);

    const undeclaredInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: {
        ...admissionRequest(expert),
        identity: { task: 'foreign', agent: 'foreign', attempt: 1 },
      },
    };
    await expect(admitDelegationAttempt(undeclaredInput)).rejects.toThrow(
      'is not predeclared',
    );
    const wrongSourceInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: { ...admissionRequest(expert), sourceCommit: 'b'.repeat(40) },
    };
    await expect(admitDelegationAttempt(wrongSourceInput)).rejects.toThrow(
      'does not match the immutable plan',
    );
    const wrongDepthInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: { ...admissionRequest(expert), depth: 3 },
    };
    await expect(admitDelegationAttempt(wrongDepthInput)).rejects.toThrow(
      'does not match the immutable plan',
    );
    const wrongParentInput: AdmitDelegationAttemptInput = {
      ...loadInput,
      request: {
        ...admissionRequest(expert),
        parent: { kind: AgentAttemptParentKind.WorkflowRoot },
      },
    };
    await expect(admitDelegationAttempt(wrongParentInput)).rejects.toThrow(
      'does not match the immutable plan',
    );
    const eventLines = (await readFile(started.eventsPath, 'utf8'))
      .trim()
      .split('\n');
    expect(eventLines).toHaveLength(2);
  });

  test('rejects reuse of an existing run directory', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'nook-delegation-'));
    const startInput: StartDelegationRunInput = {
      workingDirectory: temporaryDirectory,
      plan: validPlan(),
    };
    await startDelegationRun(startInput);
    await expect(startDelegationRun(startInput)).rejects.toThrow();
  });
});

function validPlan(): DelegationPlan {
  const root: DelegationAttemptDeclaration = {
    identity: ROOT,
    depth: 1,
    parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [EXPERT],
    },
  };
  const expert: DelegationAttemptDeclaration = {
    identity: EXPERT,
    depth: 2,
    parent: { kind: AgentAttemptParentKind.AgentAttempt, ...ROOT },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [SPECIALIST],
    },
  };
  const specialist: DelegationAttemptDeclaration = {
    identity: SPECIALIST,
    depth: 3,
    parent: { kind: AgentAttemptParentKind.AgentAttempt, ...EXPERT },
    terminalBarrier: {
      policy: DelegationBarrierPolicy.AllTerminal,
      attempts: [],
    },
  };
  return {
    schemaVersion: DELEGATION_PLAN_SCHEMA_VERSION,
    workflow: DelegatedAgentWorkflowName.AgentWork,
    runId: RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    rootMaterializer: ROOT,
    attempts: [root, expert, specialist],
  };
}

function admissionRequest(
  declaration: DelegationAttemptDeclaration,
): DelegationAdmissionRequest {
  return {
    runId: RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    identity: declaration.identity,
    depth: declaration.depth,
    parent: declaration.parent,
  };
}
