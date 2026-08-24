import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { MakeDirectoryOptions, RmOptions } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  MODULE_EXPERT_CATALOG,
  WEB_EXPERT_SKILL_AUTHORITY_PATHS,
} from '../../src/module-experts/catalog.ts';
import type { ModuleExpertProfile } from '../../src/module-experts/catalog.ts';
import { createModuleExpertRuntimeIsolation } from '../../src/module-experts/runtime-contract.ts';
import type { ModuleExpertRuntimeIsolationRequest } from '../../src/module-experts/runtime-contract.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';

const UNRELATED_PRODUCT_SPEC = '.cortex/product-specs/monorepo-setup.md';
const UNRELATED_CI_AUTHORITY = '.github/workflows/unrelated.yml';
const REMOVE_RECURSIVELY: RmOptions = { recursive: true, force: true };

type WebSnapshotFixture = {
  readonly root: string;
  readonly sourceCommit: string;
};

test('materializes exact committed web product and release authorities', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-web-snapshot-'));
  try {
    const fixture = await createWebSnapshotFixture(fixtureRoot);
    const temporaryRoot = join(fixtureRoot, 'isolated');
    await mkdir(temporaryRoot);
    const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
      expertName: 'web_expert',
      parentEnvironment: {
        CODEX_API_KEY: 'web-snapshot-test-key',
        PATH: process.env.PATH ?? '',
      },
      sourceCommit: fixture.sourceCommit,
      temporaryRoot,
      workingDirectory: fixture.root,
    };
    const isolation =
      await createModuleExpertRuntimeIsolation(isolationRequest);
    try {
      const profile = webExpertProfile();
      for (const scopePath of profile.scopePaths) {
        expect(
          await readFile(join(isolation.repositorySnapshot, scopePath), 'utf8'),
        ).toBe(`committed:${scopePath}\n`);
      }
      for (const authorityPath of WEB_EXPERT_SKILL_AUTHORITY_PATHS) {
        await expect(
          access(join(isolation.repositorySnapshot, authorityPath)),
        ).resolves.toBeFalsy();
      }
      await expect(
        access(join(isolation.repositorySnapshot, UNRELATED_PRODUCT_SPEC)),
      ).rejects.toThrow();
      await expect(
        access(join(isolation.repositorySnapshot, UNRELATED_CI_AUTHORITY)),
      ).rejects.toThrow();
    } finally {
      await isolation.dispose();
    }
  } finally {
    await rm(fixtureRoot, REMOVE_RECURSIVELY);
  }
});

async function createWebSnapshotFixture(
  fixtureRoot: string,
): Promise<WebSnapshotFixture> {
  const root = join(fixtureRoot, 'repository');
  await mkdir(root);
  const profile = webExpertProfile();
  const paths = [
    '.cortex/knowledge-graph.md',
    UNRELATED_PRODUCT_SPEC,
    UNRELATED_CI_AUTHORITY,
    profile.agentDefinitionPath,
    ...profile.canonicalContextPaths,
    ...profile.moduleRoots.map((moduleRoot) => join(moduleRoot, 'fixture.txt')),
    ...profile.scopePaths,
    ...profile.publicEntryPoints,
    ...profile.authorityPaths,
    ...profile.skillPaths,
  ];
  const directoryOptions: MakeDirectoryOptions = { recursive: true };
  for (const path of new Set(paths)) {
    await mkdir(dirname(join(root, path)), directoryOptions);
    await writeFile(join(root, path), `committed:${path}\n`, 'utf8');
  }
  commitFixture(root);
  const revisionCommand: RunCommandArgs = {
    args: ['rev-parse', 'HEAD'],
    command: 'git',
    cwd: root,
  };
  const sourceCommit = gitOutput(revisionCommand);
  for (const scopePath of profile.scopePaths) {
    await writeFile(join(root, scopePath), 'mutable scope content\n', 'utf8');
  }
  return { root, sourceCommit };
}

function commitFixture(root: string): void {
  const initCommand: RunCommandArgs = {
    args: ['init'],
    command: 'git',
    cwd: root,
  };
  gitOutput(initCommand);
  const addCommand: RunCommandArgs = {
    args: ['add', '.'],
    command: 'git',
    cwd: root,
  };
  gitOutput(addCommand);
  const commitCommand: RunCommandArgs = {
    args: [
      '-c',
      'user.name=Nook Test',
      '-c',
      'user.email=nook-test@example.test',
      'commit',
      '-m',
      'fixture',
    ],
    command: 'git',
    cwd: root,
  };
  gitOutput(commitCommand);
}

function gitOutput(command: RunCommandArgs): string {
  const result = runCommand(command);
  if (result.exitCode !== 0) throw new Error('Fixture Git command failed.');
  return result.stdout.trim();
}

function webExpertProfile(): ModuleExpertProfile {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === 'web_expert',
  );
  if (!profile) throw new Error('web_expert profile is missing.');
  return profile;
}
