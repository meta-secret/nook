import { expect, test } from 'bun:test';
import { analyzeShellCommands } from './skill-provider-command-boundary.ts';
import type { ConfigurationNode } from './skill-provider-command-types.ts';
import { workflowCommandSources } from './skill-provider-workflow-commands.ts';

test('preserves dynamic execution environment for fail-closed auditing', () => {
  const document: ConfigurationNode = {
    env: {
      NODE_OPTIONS: '--require=${{ github.workspace }}/scripts/facade.cjs',
      SAFE_LABEL: '${{ github.ref_name }}',
    },
    jobs: {
      audit: {
        steps: [{ run: 'node scripts/safe.js' }],
      },
    },
  };
  const request = { action: false, document };
  const commands = workflowCommandSources(request);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toContain('NODE_OPTIONS=');
  expect(commands[0]).not.toContain('SAFE_LABEL=');
  const inspection = {
    positionalArguments: false as const,
    source: commands[0] as string,
    sourcePath: '.github/workflows/audit.yml',
  };
  expect(() => analyzeShellCommands(inspection)).toThrow(
    'NODE_OPTIONS execution is forbidden.',
  );
});
