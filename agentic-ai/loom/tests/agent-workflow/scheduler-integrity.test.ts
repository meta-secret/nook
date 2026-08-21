import { rm } from 'node:fs/promises';
import type { RmOptions } from 'node:fs';
import { expect, test } from 'bun:test';
import { CortexAuditTask } from '../../src/agent-workflow/cortex-workflow.ts';
import {
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowTerminalKind,
} from '../../src/agent-workflow/domain.ts';
import { runStaticWorkflow } from '../../src/agent-workflow/scheduler.ts';
import {
  createSchedulerFixture,
  type ScriptedRuntimeConfiguration,
} from './scheduler-fixture.ts';

test('rejects a parent result when a dependency changes during synthesis', async () => {
  const runtimeConfiguration: ScriptedRuntimeConfiguration = {
    failedTask: false,
    tamperResultArtifactDuringSynthesis: true,
  };
  const fixture = await createSchedulerFixture(runtimeConfiguration);
  const removeOptions: RmOptions = { recursive: true, force: true };
  try {
    const terminal = await runStaticWorkflow(fixture.configuration);
    expect(terminal.kind).toBe(WorkflowTerminalKind.CompletedWithFailures);
    const synthesis = terminal.taskTerminals.find(
      (task) => task.task === CortexAuditTask.SynthesizeFindings,
    );
    expect(synthesis?.kind).toBe(TaskTerminalKind.Failed);
    if (synthesis?.kind !== TaskTerminalKind.Failed) {
      throw new Error('Expected synthesis to reject changed dependencies.');
    }
    expect(synthesis.summary).toContain('changed during parent execution');
    expect(terminal.materializedView.presence).toBe(
      MaterializedViewPresence.Recorded,
    );
    if (
      terminal.materializedView.presence === MaterializedViewPresence.Recorded
    ) {
      expect(terminal.materializedView.authorKind).toBe(
        MaterializedViewAuthorKind.LoomRuntime,
      );
    }
  } finally {
    await rm(fixture.runRoot, removeOptions);
  }
});
