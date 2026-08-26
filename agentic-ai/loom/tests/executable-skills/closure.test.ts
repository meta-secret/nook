import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { PlanExecutableSkillClosureRequest } from '../../src/executable-skills/closure.ts';
import { ExecutableSkillClosureEntryRole } from '../../src/executable-skills/domain.ts';
import {
  createExecutableSkillFixture,
  FIXTURE_DOCKER_ENVIRONMENT,
  FIXTURE_REGISTRATION,
  planExecutableSkillClosure,
  stageFixturePath,
  writeFixtureFile,
  writeFixtureTree,
} from './fixture.ts';

setDefaultTimeout(30_000);

function closureRequest(
  repositoryRoot: string,
): PlanExecutableSkillClosureRequest {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    definition: FIXTURE_REGISTRATION,
    dockerEnvironment: FIXTURE_DOCKER_ENVIRONMENT,
    repositoryRoot,
    signal: false,
    sourceTree: writeFixtureTree(repositoryRoot),
  };
}

async function createDefaultFixture() {
  const request = {};
  return createExecutableSkillFixture(request);
}

describe('immutable executable skill closure', () => {
  test('returns one deterministic deeply frozen closure plan', async () => {
    const fixture = await createDefaultFixture();
    try {
      const first = await planExecutableSkillClosure(
        closureRequest(fixture.repositoryRoot),
      );
      const second = await planExecutableSkillClosure(
        closureRequest(fixture.repositoryRoot),
      );
      expect(first).toEqual(second);
      expect(first.runnerRelativePath).toBe(FIXTURE_REGISTRATION.runnerPath);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.entries)).toBe(true);
      expect(first.entries.every((entry) => Object.isFrozen(entry))).toBe(true);
      const paths = first.entries.map((entry) => entry.relativePath);
      expect(paths).toEqual([...paths].sort());
      const sourceEntries = first.entries.filter(
        (entry) =>
          entry.role === ExecutableSkillClosureEntryRole.ExecutionSource,
      );
      expect(sourceEntries.map((entry) => entry.relativePath)).toEqual([
        '.agents/skills/fixture/src/runner.ts',
        '.agents/skills/fixture/src/support.ts',
      ]);
      expect(first.entries.map((entry) => entry.role)).toContain(
        ExecutableSkillClosureEntryRole.ManifestProvenance,
      );
    } finally {
      await fixture.dispose();
    }
  });

  test('rejects worktree drift from the exact frozen tree', async () => {
    const fixture = await createDefaultFixture();
    try {
      const request = closureRequest(fixture.repositoryRoot);
      const auditedPlan = await planExecutableSkillClosure(request);
      const auditedSupport = auditedPlan.entries.find((entry) =>
        entry.relativePath.endsWith('/support.ts'),
      );
      const writeRequest = {
        content: 'export const value = 2;\n',
        relativePath: '.agents/skills/fixture/src/support.ts',
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      await expect(planExecutableSkillClosure(request)).rejects.toThrow(
        'worktree/index drift',
      );
      expect(auditedSupport?.content).toBe('export const value = 1;\n');
    } finally {
      await fixture.dispose();
    }
  });

  test('binds the plan digest to exact source content', async () => {
    const first = await createDefaultFixture();
    const secondFixtureRequest = {
      supportSource: 'export const value = 2;\n',
    };
    const second = await createExecutableSkillFixture(secondFixtureRequest);
    try {
      const firstPlan = await planExecutableSkillClosure(
        closureRequest(first.repositoryRoot),
      );
      const secondPlan = await planExecutableSkillClosure(
        closureRequest(second.repositoryRoot),
      );
      expect(firstPlan.closureSha256).not.toBe(secondPlan.closureSha256);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  test('rejects forbidden capability in a recursive imported source', async () => {
    const sources = [
      "import 'node:util';\nexport const value = 1;\n",
      "fs.readFileSync('/etc/passwd');\nexport const value = 1;\n",
      "child_process.execSync('echo unsafe');\nexport const value = 1;\n",
      "const DynamicLoader = Loader; new DynamicLoader('./module.ts');\n",
      'const Realm = ShadowRealm; new Realm();\n',
      "Bun.stdout = '/tmp/out';\n",
      '({ stderr: Bun.stderr } = value);\n',
      'for ({ ...Bun.stdout } of values) {}\n',
    ];
    for (const supportSource of sources) {
      const fixtureRequest = { supportSource };
      const fixture = await createExecutableSkillFixture(fixtureRequest);
      try {
        const expectedError = {
          relativePath: '.agents/skills/fixture/src/support.ts',
        };
        await expect(
          planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
        ).rejects.toMatchObject(expectedError);
      } finally {
        await fixture.dispose();
      }
    }
  });

  test('attributes a local import escape to its importer', async () => {
    const fixtureRequest = {
      supportSource:
        "import { secret } from '../../../../outside.ts';\nexport const value = secret;\n",
    };
    const fixture = await createExecutableSkillFixture(fixtureRequest);
    try {
      const expectedError = {
        relativePath: '.agents/skills/fixture/src/support.ts',
      };
      await expect(
        planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
      ).rejects.toMatchObject(expectedError);
    } finally {
      await fixture.dispose();
    }
  });

  test('accepts absent dependencies and rejects malformed package provenance', async () => {
    const absent = await createDefaultFixture();
    try {
      const writeRequest = {
        content: '{}',
        relativePath: '.agents/skills/package.json',
        repositoryRoot: absent.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      stageFixturePath(writeRequest);
      await planExecutableSkillClosure(closureRequest(absent.repositoryRoot));
    } finally {
      await absent.dispose();
    }
    const packages = [
      'null',
      'false',
      '1',
      '"package"',
      '[]',
      '{"dependencies":null}',
      '{"dependencies":false}',
      '{"dependencies":1}',
      '{"dependencies":"package"}',
      '{"dependencies":[]}',
      '{"dependencies":{"left-pad":"1.3.0"}}',
    ];
    for (const content of packages) {
      const fixture = await createDefaultFixture();
      try {
        const writeRequest = {
          content,
          relativePath: '.agents/skills/package.json',
          repositoryRoot: fixture.repositoryRoot,
        };
        await writeFixtureFile(writeRequest);
        stageFixturePath(writeRequest);
        const expectedError = { relativePath: '.agents/skills/package.json' };
        await expect(
          planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
        ).rejects.toMatchObject(expectedError);
      } finally {
        await fixture.dispose();
      }
    }
  });

  test('preserves cancellation before planning reads closure content', async () => {
    const fixture = await createDefaultFixture();
    const controller = new AbortController();
    controller.abort();
    try {
      const request: PlanExecutableSkillClosureRequest = {
        ...closureRequest(fixture.repositoryRoot),
        signal: controller.signal,
      };
      await expect(planExecutableSkillClosure(request)).rejects.toThrow(
        'cancelled',
      );
    } finally {
      await fixture.dispose();
    }
  });
});
