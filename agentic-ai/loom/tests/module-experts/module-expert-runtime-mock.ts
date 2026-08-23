import { spyOn } from 'bun:test';
import * as codexRuntime from '../../src/agent-workflow/codex-runtime.ts';
import type { RunIsolatedModuleExpertCodexArgs } from '../../src/agent-workflow/codex-runtime.ts';
import type { AgentTaskRuntime } from '../../src/agent-workflow/runtime.ts';

export type RegisterModuleExpertRuntimeMockArgs = {
  readonly runId: string;
  readonly runtime: AgentTaskRuntime<string, string>;
};

export type ModuleExpertRuntimeMockRegistration = {
  readonly dispose: () => void;
};

const registeredRuntimes = new Map<
  string,
  AgentTaskRuntime<string, string>[]
>();
const originalRunIsolatedModuleExpertCodex =
  codexRuntime.runIsolatedModuleExpertCodex;

spyOn(codexRuntime, 'runIsolatedModuleExpertCodex').mockImplementation(
  async <TTask extends string, TAgent extends string>(
    args: RunIsolatedModuleExpertCodexArgs<TTask, TAgent>,
  ) => {
    const runtimes = registeredRuntimes.get(args.invocation.runId);
    const registeredRuntime = runtimes?.at(-1);
    if (registeredRuntime) {
      return registeredRuntime.executeAgent(args.invocation);
    }
    return originalRunIsolatedModuleExpertCodex(args);
  },
);

export function registerModuleExpertRuntimeMock(
  args: RegisterModuleExpertRuntimeMockArgs,
): ModuleExpertRuntimeMockRegistration {
  const runtimes = registeredRuntimes.get(args.runId) ?? [];
  runtimes.push(args.runtime);
  registeredRuntimes.set(args.runId, runtimes);
  return {
    dispose: () => {
      const registered = registeredRuntimes.get(args.runId);
      if (registered?.at(-1) !== args.runtime) {
        throw new Error(
          `Runtime mocks for ${args.runId} were disposed out of order.`,
        );
      }
      registered.pop();
      if (registered.length === 0) {
        registeredRuntimes.delete(args.runId);
      }
    },
  };
}
