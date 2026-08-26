import {
  assertSourceAnalysisRequestBounds,
  decodeSourceAnalysisResult,
  encodeSourceAnalysisRequest,
} from './source-analysis-codec.ts';
import {
  resolveSealedSourceAnalysisContainerOutput,
  runSealedSourceAnalysisContainer,
  type RunSealedSourceAnalysisContainerRequest,
  type SealedSourceAnalysisDockerEnvironment,
} from './source-analysis-docker.ts';
import type { ExecutableSkillSourceAnalysis } from './source-policy.ts';

export type RunExecutableSkillSourceAnalysisRequest = {
  readonly deadlineExpiresAt: number;
  readonly dockerEnvironment: SealedSourceAnalysisDockerEnvironment;
  readonly relativePath: string;
  readonly signal: AbortSignal | false;
  readonly source: string;
};

export type SourceAnalysisContainerExecutor = (
  request: RunSealedSourceAnalysisContainerRequest,
) => Promise<{ readonly serializedResult: string }>;

export type SourceAnalysisRuntimeDependencies = {
  readonly executeContainer: SourceAnalysisContainerExecutor;
};

type RunSourceAnalysisWithDependenciesRequest = {
  readonly dependencies: SourceAnalysisRuntimeDependencies;
  readonly request: RunExecutableSkillSourceAnalysisRequest;
};

type SourceAnalysisSlotRequest = {
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
};

type SourceAnalysisSlot = {
  readonly release: () => void;
};

enum SlotWaitKind {
  Interrupted = 'interrupted',
  Ready = 'ready',
}

type SlotWaitOutcome = SlotWaitKind.Interrupted | SlotWaitKind.Ready;

let sourceAnalysisTail: Promise<void> = Promise.resolve();
let sourceAnalysisPending = 0;
const MINIMUM_SOURCE_ANALYSIS_MILLISECONDS = 20_000;
const MINIMUM_SOURCE_ANALYSIS_EXECUTION_MILLISECONDS = 20_000;
const MAXIMUM_SOURCE_ANALYSIS_MILLISECONDS = 5 * 60 * 1_000;
const MAXIMUM_PENDING_SOURCE_ANALYSES = 8;

export async function runExecutableSkillSourceAnalysis(
  request: RunExecutableSkillSourceAnalysisRequest,
): Promise<ExecutableSkillSourceAnalysis> {
  const dependencies: SourceAnalysisRuntimeDependencies = {
    executeContainer: executeProductionContainer,
  };
  const executionRequest: RunSourceAnalysisWithDependenciesRequest = {
    dependencies,
    request,
  };
  return await runSourceAnalysisWithDependencies(executionRequest);
}

async function executeProductionContainer(
  request: RunSealedSourceAnalysisContainerRequest,
): Promise<{ readonly serializedResult: string }> {
  const output = await runSealedSourceAnalysisContainer(request);
  const resolveRequest = { output };
  return resolveSealedSourceAnalysisContainerOutput(resolveRequest);
}

export async function runSourceAnalysisWithDependencies(
  execution: RunSourceAnalysisWithDependenciesRequest,
): Promise<ExecutableSkillSourceAnalysis> {
  const request = execution.request;
  assertSourceAnalysisDeadline(request.deadlineExpiresAt);
  assertSourceAnalysisRequestBounds(request);
  assertSourceAnalysisActive(request);
  const slotRequest: SourceAnalysisSlotRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    signal: request.signal,
  };
  const slot = await acquireSourceAnalysisSlot(slotRequest);
  try {
    assertSourceAnalysisExecutionBudget(request);
    const serializedRequest = encodeSourceAnalysisRequest(request);
    const containerRequest: RunSealedSourceAnalysisContainerRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      dockerEnvironment: request.dockerEnvironment,
      serializedRequest,
      signal: request.signal,
    };
    const output =
      await execution.dependencies.executeContainer(containerRequest);
    assertSourceAnalysisActive(request);
    return decodeSourceAnalysisResult(output.serializedResult);
  } finally {
    slot.release();
  }
}

function assertSourceAnalysisDeadline(deadlineExpiresAt: number): void {
  const remaining = deadlineExpiresAt - Date.now();
  if (
    !Number.isSafeInteger(deadlineExpiresAt) ||
    remaining < MINIMUM_SOURCE_ANALYSIS_MILLISECONDS ||
    remaining > MAXIMUM_SOURCE_ANALYSIS_MILLISECONDS
  ) {
    throw new Error('Sealed source analysis total deadline is invalid.');
  }
}

async function acquireSourceAnalysisSlot(
  request: SourceAnalysisSlotRequest,
): Promise<SourceAnalysisSlot> {
  if (sourceAnalysisPending >= MAXIMUM_PENDING_SOURCE_ANALYSES) {
    throw new Error('Sealed source analysis queue reached its capacity.');
  }
  sourceAnalysisPending += 1;
  const previous = sourceAnalysisTail;
  let releaseCurrent = (): void => {};
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  sourceAnalysisTail = previous.then(() => current);
  const waitRequest: WaitForSourceAnalysisSlotRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    previous,
    signal: request.signal,
  };
  const wait = waitForSourceAnalysisSlot(waitRequest);
  let outcome: SlotWaitOutcome;
  try {
    outcome = await wait.promise;
  } finally {
    wait.dispose();
    sourceAnalysisPending -= 1;
  }
  if (outcome === SlotWaitKind.Interrupted) {
    releaseCurrent();
    assertSourceAnalysisExecutionBudget(request);
    throw new Error('Sealed source analysis slot wait was interrupted.');
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      releaseCurrent();
    },
  };
}

type SourceAnalysisSlotWait = {
  readonly dispose: () => void;
  readonly promise: Promise<SlotWaitOutcome>;
};

type WaitForSourceAnalysisSlotRequest = SourceAnalysisSlotRequest & {
  readonly previous: Promise<void>;
};

function waitForSourceAnalysisSlot(
  request: WaitForSourceAnalysisSlotRequest,
): SourceAnalysisSlotWait {
  let timer: ReturnType<typeof setTimeout> | false = false;
  let listener: (() => void) | false = false;
  const promise = new Promise<SlotWaitOutcome>((resolve) => {
    request.previous.then(() => resolve(SlotWaitKind.Ready));
    const delay = Math.max(
      0,
      request.deadlineExpiresAt -
        MINIMUM_SOURCE_ANALYSIS_EXECUTION_MILLISECONDS -
        Date.now(),
    );
    timer = setTimeout(() => resolve(SlotWaitKind.Interrupted), delay);
    if (request.signal !== false) {
      listener = () => resolve(SlotWaitKind.Interrupted);
      request.signal.addEventListener('abort', listener);
    }
  });
  return {
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && listener !== false) {
        request.signal.removeEventListener('abort', listener);
      }
    },
    promise,
  };
}

function assertSourceAnalysisExecutionBudget(
  request: RunExecutableSkillSourceAnalysisRequest | SourceAnalysisSlotRequest,
): void {
  assertSourceAnalysisActive(request);
  if (
    request.deadlineExpiresAt - Date.now() <
    MINIMUM_SOURCE_ANALYSIS_EXECUTION_MILLISECONDS
  ) {
    throw new Error('Sealed source analysis execution budget expired.');
  }
}

function assertSourceAnalysisActive(
  request: RunExecutableSkillSourceAnalysisRequest | SourceAnalysisSlotRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Sealed source analysis was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Sealed source analysis deadline expired.');
  }
}
