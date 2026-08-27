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
  WEB_EXPERT_ALLOWED_CONTEXT_PATHS,
  WEB_EXPERT_SKILL_AUTHORITY_PATHS,
} from '../../src/module-experts/catalog.ts';
import type {
  ModuleExpertProfile,
  WebExpertAllowedContextPath,
} from '../../src/module-experts/catalog.ts';
import { createModuleExpertRuntimeIsolation } from '../../src/module-experts/runtime-contract.ts';
import type { ModuleExpertRuntimeIsolationRequest } from '../../src/module-experts/runtime-contract.ts';
import { runCommand } from '../../src/lib/run.ts';
import type { RunCommandArgs } from '../../src/lib/run.ts';

const UNRELATED_PRODUCT_SPEC =
  '.cortex/teams/sre/product-specs/monorepo-setup.md';
const UNRELATED_CI_AUTHORITY = '.github/workflows/unrelated.yml';
const VENDOR_CORE_PROFILE = '.codex/agents/module-experts/core_expert.toml';
const DESIGN_SKILL_PATH =
  '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md';
const EXTENSION_RELEASE_SKILL_PATH =
  '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md';
const SELECTED_CONTEXT_PATHS: readonly WebExpertAllowedContextPath[] = [
  '.cortex/teams/web-dev/product-specs/browser-extension.md',
  '.github/workflows/release.yml',
  DESIGN_SKILL_PATH,
  EXTENSION_RELEASE_SKILL_PATH,
];
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
      selectedContextPaths: SELECTED_CONTEXT_PATHS,
      temporaryRoot,
      workingDirectory: fixture.root,
    };
    const isolation =
      await createModuleExpertRuntimeIsolation(isolationRequest);
    try {
      const profile = webExpertProfile();
      expect(isolation.selectedContextPaths).toEqual(SELECTED_CONTEXT_PATHS);
      for (const scopePath of SELECTED_CONTEXT_PATHS) {
        expect(
          await readFile(join(isolation.repositorySnapshot, scopePath), 'utf8'),
        ).toBe(`committed:${scopePath}\n`);
      }
      for (const allowedPath of WEB_EXPERT_ALLOWED_CONTEXT_PATHS) {
        if (SELECTED_CONTEXT_PATHS.includes(allowedPath)) continue;
        await expect(
          access(join(isolation.repositorySnapshot, allowedPath)),
        ).rejects.toThrow();
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
      await expect(
        access(join(isolation.repositorySnapshot, VENDOR_CORE_PROFILE)),
      ).rejects.toThrow();
    } finally {
      await isolation.dispose();
    }
  } finally {
    await rm(fixtureRoot, REMOVE_RECURSIVELY);
  }
});

test('keeps ordinary web analysis free of design and extension release context', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'loom-web-base-snapshot-'));
  try {
    const fixture = await createWebSnapshotFixture(fixtureRoot);
    const temporaryRoot = join(fixtureRoot, 'isolated');
    await mkdir(temporaryRoot);
    const isolationRequest: ModuleExpertRuntimeIsolationRequest = {
      expertName: 'web_expert',
      parentEnvironment: {
        CODEX_API_KEY: 'web-base-snapshot-test-key',
        PATH: process.env.PATH ?? '',
      },
      sourceCommit: fixture.sourceCommit,
      selectedContextPaths: [],
      temporaryRoot,
      workingDirectory: fixture.root,
    };
    const isolation =
      await createModuleExpertRuntimeIsolation(isolationRequest);
    try {
      expect(isolation.selectedContextPaths).toEqual([]);
      for (const excludedTaskContext of [
        DESIGN_SKILL_PATH,
        EXTENSION_RELEASE_SKILL_PATH,
      ]) {
        await expect(
          access(join(isolation.repositorySnapshot, excludedTaskContext)),
        ).rejects.toThrow();
      }
      await expect(
        access(
          join(
            isolation.repositorySnapshot,
            '.cortex/teams/ai/dynamic-skills/module-expert.md',
          ),
        ),
      ).resolves.toBeFalsy();
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
    VENDOR_CORE_PROFILE,
    ...profile.canonicalContextPaths,
    ...profile.moduleRoots.map((moduleRoot) => join(moduleRoot, 'fixture.txt')),
    ...profile.allowedContextPaths,
    ...profile.publicEntryPoints,
    ...profile.authorityPaths,
    ...profile.skillPaths,
  ];
  const directoryOptions: MakeDirectoryOptions = { recursive: true };
  for (const path of new Set(paths)) {
    await mkdir(dirname(join(root, path)), directoryOptions);
    await writeFile(join(root, path), `committed:${path}\n`, 'utf8');
  }
  await writeFile(
    join(root, VENDOR_CORE_PROFILE),
    'name = "core_expert"\nsandbox_mode = "workspace-write"\n',
    'utf8',
  );
  commitFixture(root);
  const revisionCommand: RunCommandArgs = {
    args: ['rev-parse', 'HEAD'],
    command: 'git',
    cwd: root,
  };
  const sourceCommit = gitOutput(revisionCommand);
  for (const scopePath of profile.allowedContextPaths) {
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
