import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, setDefaultTimeout, test } from 'bun:test';
import { EXECUTABLE_SKILL_CLOSURE_LIMITS } from '../../src/executable-skills/closure.ts';
import type { PlanExecutableSkillClosureRequest } from '../../src/executable-skills/closure.ts';
import {
  createExecutableSkillFixture,
  createFixtureFifo,
  FIXTURE_DOCKER_ENVIRONMENT,
  FIXTURE_REGISTRATION,
  planExecutableSkillClosure,
  stageAllFixtureFiles,
  writeFixtureFile,
  writeFixtureTree,
} from './fixture.ts';

setDefaultTimeout(60_000);

const SUPPORT_PATH = '.agents/skills/fixture/src/support.ts';
const removeOptions = { force: true, recursive: true } as const;

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

test('enforces exact closure file and import-edge bounds', async () => {
  const fixtureRequest = { runnerSource: 'export {};\n' };
  const fixture = await createExecutableSkillFixture(fixtureRequest);
  try {
    const dependencyCount = EXECUTABLE_SKILL_CLOSURE_LIMITS.files - 5;
    const imports: string[] = [];
    for (let index = 0; index < dependencyCount; index += 1) {
      const name = `dependency-${index}.ts`;
      imports.push(`import './${name}';`);
      const writeRequest = {
        content: 'export {};\n',
        relativePath: `.agents/skills/fixture/src/${name}`,
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
    }
    const exactRunnerRequest = {
      content: `${imports.join('\n')}\n`,
      relativePath: FIXTURE_REGISTRATION.runnerPath,
      repositoryRoot: fixture.repositoryRoot,
    };
    await writeFixtureFile(exactRunnerRequest);
    stageAllFixtureFiles(fixture.repositoryRoot);
    await planExecutableSkillClosure(closureRequest(fixture.repositoryRoot));

    const extraPath = `.agents/skills/fixture/src/dependency-${dependencyCount}.ts`;
    const extraRequest = {
      content: 'export {};\n',
      relativePath: extraPath,
      repositoryRoot: fixture.repositoryRoot,
    };
    await writeFixtureFile(extraRequest);
    const overFileRunner = {
      ...exactRunnerRequest,
      content:
        `${imports.join('\n')}\n` +
        `import './dependency-${dependencyCount}.ts';\n`,
    };
    await writeFixtureFile(overFileRunner);
    stageAllFixtureFiles(fixture.repositoryRoot);
    await expect(
      planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
    ).rejects.toThrow('file count limit');

    await unlink(path.join(fixture.repositoryRoot, extraPath));
    const exactEdges = new Array<string>(
      EXECUTABLE_SKILL_CLOSURE_LIMITS.edges,
    ).fill("import './dependency-0.ts';");
    const exactEdgeRunner = {
      ...exactRunnerRequest,
      content: `${exactEdges.join('\n')}\n`,
    };
    await writeFixtureFile(exactEdgeRunner);
    stageAllFixtureFiles(fixture.repositoryRoot);
    await planExecutableSkillClosure(closureRequest(fixture.repositoryRoot));
    const overEdgeRunner = {
      ...exactRunnerRequest,
      content: `${exactEdges.join('\n')}\nimport './dependency-0.ts';\n`,
    };
    await writeFixtureFile(overEdgeRunner);
    stageAllFixtureFiles(fixture.repositoryRoot);
    await expect(
      planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
    ).rejects.toThrow('import edge limit');
  } finally {
    await fixture.dispose();
  }
});

test('enforces the aggregate closure byte bound plus one', async () => {
  const fixtureRequest = {
    runnerSource: "import './support.ts';\n",
  };
  const fixture = await createExecutableSkillFixture(fixtureRequest);
  try {
    const metadataPaths = [
      FIXTURE_REGISTRATION.runnerPath,
      FIXTURE_REGISTRATION.manifestPath,
      '.agents/skills/package.json',
      '.agents/skills/bun.lock',
      '.cortex/architecture/fixture.md',
    ];
    let fixedBytes = 0;
    for (const relativePath of metadataPaths) {
      fixedBytes += Buffer.byteLength(
        await readFile(path.join(fixture.repositoryRoot, relativePath), 'utf8'),
        'utf8',
      );
    }
    const sourcePaths: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      sourcePaths.push(
        index === 0
          ? SUPPORT_PATH
          : `.agents/skills/fixture/src/aggregate-${index}.ts`,
      );
    }
    const scaffolds: string[] = [];
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const next = sourcePaths[index + 1];
      scaffolds.push(
        next ? `import './${path.basename(next)}';\n` : 'export {};\n',
      );
    }
    for (const scaffold of scaffolds) {
      fixedBytes += Buffer.byteLength(scaffold, 'utf8');
    }
    let remaining = EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes - fixedBytes;
    for (const [index, relativePath] of sourcePaths.entries()) {
      const sourcesLeft = sourcePaths.length - index;
      const paddingBytes = Math.floor(remaining / sourcesLeft);
      remaining -= paddingBytes;
      const writeRequest = {
        content: `${scaffolds[index]}${' '.repeat(paddingBytes)}`,
        relativePath,
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
    }
    stageAllFixtureFiles(fixture.repositoryRoot);
    await planExecutableSkillClosure(closureRequest(fixture.repositoryRoot));
    const overflowPath = sourcePaths.at(-1);
    if (!overflowPath) throw new Error('Aggregate fixture path is missing.');
    const overflowContent = await readFile(
      path.join(fixture.repositoryRoot, overflowPath),
      'utf8',
    );
    const overflowWrite = {
      content: `${overflowContent} `,
      relativePath: overflowPath,
      repositoryRoot: fixture.repositoryRoot,
    };
    await writeFixtureFile(overflowWrite);
    stageAllFixtureFiles(fixture.repositoryRoot);
    await expect(
      planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
    ).rejects.toThrow('aggregate byte limit');
  } finally {
    await fixture.dispose();
  }
});

test('rejects no-follow, nonregular, oversized, and growing descriptors', async () => {
  for (const mutation of ['oversized', 'symlink', 'fifo', 'growing']) {
    const fixtureRequest = {};
    const fixture = await createExecutableSkillFixture(fixtureRequest);
    let growth: ReturnType<typeof setInterval> | false = false;
    try {
      const absolutePath = path.join(fixture.repositoryRoot, SUPPORT_PATH);
      const request = closureRequest(fixture.repositoryRoot);
      if (mutation === 'oversized') {
        const writeRequest = {
          content: 'x'.repeat(EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes + 1),
          relativePath: SUPPORT_PATH,
          repositoryRoot: fixture.repositoryRoot,
        };
        await writeFixtureFile(writeRequest);
      } else if (mutation === 'symlink') {
        await unlink(absolutePath);
        await symlink('/tmp/outside-executable-skill-source.ts', absolutePath);
      } else if (mutation === 'fifo') {
        await unlink(absolutePath);
        const fifoRequest = {
          relativePath: SUPPORT_PATH,
          repositoryRoot: fixture.repositoryRoot,
        };
        createFixtureFifo(fifoRequest);
      } else {
        growth = setInterval(() => void appendFile(absolutePath, 'growth'), 0);
      }
      await expect(planExecutableSkillClosure(request)).rejects.toThrow(
        'worktree/index drift',
      );
    } finally {
      if (growth !== false) clearInterval(growth);
      await fixture.dispose();
    }
  }
});

test('rejects a symlink in a closure path ancestor', async () => {
  const fixtureRequest = {};
  const fixture = await createExecutableSkillFixture(fixtureRequest);
  const outsideRoot = await mkdtemp(
    path.join(tmpdir(), 'nook-skill-ancestor-symlink-'),
  );
  try {
    const sourceDirectory = path.join(
      fixture.repositoryRoot,
      '.agents/skills/fixture/src',
    );
    const outsideDirectory = path.join(outsideRoot, 'src');
    await rename(sourceDirectory, outsideDirectory);
    await symlink(outsideDirectory, sourceDirectory);
    await expect(
      planExecutableSkillClosure(closureRequest(fixture.repositoryRoot)),
    ).rejects.toThrow('worktree/index drift');
  } finally {
    await fixture.dispose();
    await rm(outsideRoot, removeOptions);
  }
});

test('requires frozen 100644 mode for every source and metadata file', async () => {
  const paths = [
    SUPPORT_PATH,
    FIXTURE_REGISTRATION.manifestPath,
    '.agents/skills/package.json',
    '.agents/skills/bun.lock',
  ];
  for (const relativePath of paths) {
    const fixtureRequest = {};
    const fixture = await createExecutableSkillFixture(fixtureRequest);
    try {
      const absolutePath = path.join(fixture.repositoryRoot, relativePath);
      const content = await readFile(absolutePath, 'utf8');
      await unlink(absolutePath);
      await symlink(content, absolutePath);
      stageAllFixtureFiles(fixture.repositoryRoot);
      const sourceTree = writeFixtureTree(fixture.repositoryRoot);
      await unlink(absolutePath);
      const writeRequest = {
        content,
        relativePath,
        repositoryRoot: fixture.repositoryRoot,
      };
      await writeFixtureFile(writeRequest);
      const request: PlanExecutableSkillClosureRequest = {
        ...closureRequest(fixture.repositoryRoot),
        sourceTree,
      };
      await expect(planExecutableSkillClosure(request)).rejects.toThrow(
        '100644',
      );
    } finally {
      await fixture.dispose();
    }
  }
});

test('compares worktree bytes without UTF-8 replacement aliases', async () => {
  const frozen = "export const value = '\uFFFD';\n";
  const fixtureRequest = { supportSource: frozen };
  const fixture = await createExecutableSkillFixture(fixtureRequest);
  try {
    const request = closureRequest(fixture.repositoryRoot);
    const frozenBytes = Buffer.from(frozen, 'utf8');
    const replacementBytes = Buffer.from('\uFFFD', 'utf8');
    const replacementOffset = frozenBytes.indexOf(replacementBytes);
    const worktree = Buffer.concat([
      frozenBytes.subarray(0, replacementOffset),
      Buffer.from([0xff]),
      frozenBytes.subarray(replacementOffset + replacementBytes.byteLength),
    ]);
    expect(worktree.toString('utf8')).toBe(frozen);
    await writeFile(path.join(fixture.repositoryRoot, SUPPORT_PATH), worktree);
    await expect(planExecutableSkillClosure(request)).rejects.toThrow(
      'worktree/index drift',
    );
  } finally {
    await fixture.dispose();
  }
});

test('deadline interrupts Git traversal without returning a plan', async () => {
  const fixtureRequest = {
    supportSource: ' '.repeat(4 * 1024 * 1024),
  };
  const fixture = await createExecutableSkillFixture(fixtureRequest);
  try {
    const request: PlanExecutableSkillClosureRequest = {
      ...closureRequest(fixture.repositoryRoot),
      deadlineExpiresAt: Date.now() + 2,
    };
    await expect(planExecutableSkillClosure(request)).rejects.toThrow(
      'deadline',
    );
  } finally {
    await fixture.dispose();
  }
});
