import { spyOn } from 'bun:test';
import * as codexRuntime from '../../src/agent-workflow/codex-runtime.ts';
import type { RunIsolatedReadOnlyExpertCodexRequest } from '../../src/agent-workflow/codex-runtime.ts';
import type { AgentTaskRuntime } from '../../src/agent-workflow/runtime.ts';

export type RegisterStructuralRuntimeMockRequest = {
  readonly runId: string;
  readonly runtime: AgentTaskRuntime<string, string>;
};

export type StructuralRuntimeMockRegistration = {
  readonly dispose: () => void;
};

const RUNTIMES = new Map<string, AgentTaskRuntime<string, string>[]>();
const original = codexRuntime.runIsolatedReadOnlyExpertCodex;

spyOn(codexRuntime, 'runIsolatedReadOnlyExpertCodex').mockImplementation(
  async <TTask extends string, TAgent extends string>(
    request: RunIsolatedReadOnlyExpertCodexRequest<TTask, TAgent>,
  ) => {
    const runtime = RUNTIMES.get(request.invocation.runId)?.at(-1);
    if (runtime) return runtime.executeAgent(request.invocation);
    return original(request);
  },
);

export function registerStructuralRuntimeMock(
  request: RegisterStructuralRuntimeMockRequest,
): StructuralRuntimeMockRegistration {
  const runtimes = RUNTIMES.get(request.runId) ?? [];
  runtimes.push(request.runtime);
  RUNTIMES.set(request.runId, runtimes);
  return {
    dispose: () => {
      const registered = RUNTIMES.get(request.runId);
      if (registered?.at(-1) !== request.runtime) {
        throw new Error('Structural runtime mocks were disposed out of order.');
      }
      registered.pop();
      if (registered.length === 0) RUNTIMES.delete(request.runId);
    },
  };
}
