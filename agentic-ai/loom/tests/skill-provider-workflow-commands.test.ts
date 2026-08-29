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
        'runs-on': 'ubuntu-latest',
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

test('rejects implicit shell startup hooks before flattening run steps', () => {
  const document: ConfigurationNode = {
    env: { BASH_ENV: 'scripts/facade.sh' },
    jobs: {
      audit: {
        'runs-on': 'ubuntu-latest',
        steps: [{ run: 'echo safe' }],
      },
    },
  };
  const request = { action: false, document };
  expect(() => workflowCommandSources(request)).toThrow(
    'BASH_ENV workflow shell startup is forbidden.',
  );
});

test('rejects execution environment mutations through GITHUB_ENV', () => {
  for (const mutation of [
    `echo 'NODE_OPTIONS=--require=./scripts/facade.cjs' >> "$GITHUB_ENV"`,
    `echo 'NODE_''OPTIONS=--require=./scripts/facade.cjs' >> "$GITHUB_ENV"`,
    `printf 'BASH_ENV=%s\\n' scripts/facade.sh >> "\${GITHUB_ENV}"`,
  ]) {
    const document: ConfigurationNode = {
      jobs: {
        audit: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: mutation }, { run: 'node scripts/neutral.cjs' }],
        },
      },
    };
    const request = { action: false, document };
    expect(() => workflowCommandSources(request), mutation).toThrow(
      /workflow command-file mutation is forbidden/u,
    );
  }
});

test('rejects workflow shells without a matching command parser', () => {
  for (const shell of ['cmd', 'powershell', 'pwsh']) {
    const document: ConfigurationNode = {
      jobs: { audit: { steps: [{ run: 'echo safe', shell }] } },
    };
    const request = { action: false, document };
    expect(() => workflowCommandSources(request), shell).toThrow(
      `Custom workflow shell is forbidden: ${shell}`,
    );
  }
  for (const shell of ['bash', 'sh']) {
    const document: ConfigurationNode = {
      jobs: { audit: { steps: [{ run: 'echo safe', shell }] } },
    };
    const request = { action: false, document };
    expect(workflowCommandSources(request), shell).toEqual(['echo safe']);
  }
});

test('rejects implicit shells unless the runner proves Bourne semantics', () => {
  for (const runner of ['windows-latest', 'self-hosted']) {
    const document: ConfigurationNode = {
      jobs: { audit: { 'runs-on': runner, steps: [{ run: 'echo safe' }] } },
    };
    const request = { action: false, document };
    expect(() => workflowCommandSources(request), runner).toThrow(
      'Implicit workflow shell is not proven to be Bash or sh.',
    );
  }
  const document: ConfigurationNode = {
    jobs: {
      audit: {
        'runs-on': 'ubuntu-latest',
        steps: [{ run: 'echo safe' }],
      },
    },
  };
  const request = { action: false, document };
  expect(workflowCommandSources(request)).toEqual(['echo safe']);
});
