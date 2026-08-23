import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, setDefaultTimeout, test } from 'bun:test';
import {
  EXECUTABLE_SKILL_CLOSURE_LIMITS,
  materializeSkillClosure,
  type MaterializeSkillClosureRequest,
} from '../src/executable-skills/closure.ts';
import {
  ExecutableSkillExecutionKind,
  ExecutableSkillHostResultContract,
  type ExecutableSkillManifest,
  type RegisteredExecutableSkill,
} from '../src/executable-skills/domain.ts';

const POLICY_PATH = '.cortex/dynamic-skills/cortex-article-structure.md';
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;
const CREATE_TREE_OPTIONS = { recursive: true } as const;
const LSTAT_MISSING_OPTIONS: { readonly throwIfNoEntry: false } = {
  throwIfNoEntry: false,
};
setDefaultTimeout(180_000);

const baseManifest: ExecutableSkillManifest = {
  schemaVersion: 1,
  id: 'stub-skill',
  executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
  requestKind: 'stub-request-v1',
  resultKind: 'stub-result-v1',
  policyPaths: [POLICY_PATH],
  limits: {
    requestBytes: 64,
    resultBytes: 64,
    timeoutMs: 50,
  },
};

test('materializes an immutable recursive staged skill closure', async () => {
  const repositoryRoot = createClosureRepository();
  try {
    const closureRequest = closureRequestFor(repositoryRoot);
    const closure = await materializeSkillClosure(closureRequest);
    try {
      expect(closure.closureSha256).toHaveLength(64);
      expect(closure.sourceTree).toMatch(/^[0-9a-f]{40,64}$/u);
      expect(
        readFileSync(
          path.join(closure.contextDirectory, 'stub-skill/src/dependency.ts'),
          'utf8',
        ),
      ).toContain('sealed dependency');
    } finally {
      const contextDirectory = closure.contextDirectory;
      closure.dispose();
      expect(Boolean(lstatSync(contextDirectory, LSTAT_MISSING_OPTIONS))).toBe(
        false,
      );
    }

    const dependencyPath = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/src/dependency.ts',
    );
    writeFileSync(dependencyPath, "export const value = 'worktree drift';\n");
    await expect(materializeSkillClosure(closureRequest)).rejects.toThrow(
      'worktree/index drift',
    );
    writeFileSync(
      dependencyPath,
      "export const value = 'sealed dependency';\n",
    );
    const manifestPath = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/executable-skill.json',
    );
    const driftedManifest = {
      ...baseManifest,
      requestKind: 'dirty-request-v1',
    };
    writeFileSync(manifestPath, JSON.stringify(driftedManifest));
    await expect(materializeSkillClosure(closureRequest)).rejects.toThrow(
      'worktree/index drift',
    );
    writeFileSync(manifestPath, JSON.stringify(baseManifest));
    const lockPath = path.join(repositoryRoot, '.agents/skills/bun.lock');
    writeFileSync(lockPath, 'lockfileVersion = 2\n');
    await expect(materializeSkillClosure(closureRequest)).rejects.toThrow(
      'worktree/index drift',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('closure abort and deadline failures leave no temporary context', async () => {
  const repositoryRoot = createClosureRepository();
  const before = closureTemporaryDirectories();
  try {
    const controller = new AbortController();
    controller.abort();
    const abortedRequest: MaterializeSkillClosureRequest = {
      deadlineExpiresAt: Date.now() + 30_000,
      definition: closureDefinition(),
      repositoryRoot,
      signal: controller.signal,
    };
    await expect(materializeSkillClosure(abortedRequest)).rejects.toThrow(
      'cancelled',
    );
    const expiredRequest: MaterializeSkillClosureRequest = {
      deadlineExpiresAt: Date.now() - 1,
      definition: closureDefinition(),
      repositoryRoot,
      signal: false,
    };
    await expect(materializeSkillClosure(expiredRequest)).rejects.toThrow(
      'deadline expired',
    );
    expect(closureTemporaryDirectories()).toEqual(before);
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('post-mkdtemp cancellation removes the materialized context', async () => {
  const repositoryRoot = createClosureRepository();
  const before = closureTemporaryDirectories();
  try {
    const sourceRoot = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/src',
    );
    const imports: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const name = `materialized-${index}.ts`;
      imports.push(`import './${name}';`);
      writeFileSync(path.join(sourceRoot, name), 'export {};\n');
    }
    writeFileSync(
      path.join(sourceRoot, 'runner.ts'),
      `${imports.join('\n')}\n`,
    );
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['add', '.'], gitOptions);
    const controller = new AbortController();
    const closureRequest: MaterializeSkillClosureRequest = {
      deadlineExpiresAt: Date.now() + 30_000,
      definition: closureDefinition(),
      repositoryRoot,
      signal: controller.signal,
    };
    const materialization = materializeSkillClosure(closureRequest);
    const waitRequest: WaitForClosureContextRequest = {
      existingNames: new Set(before),
      timeoutMs: 30_000,
    };
    const contextDirectory = await waitForClosureContext(waitRequest);
    controller.abort();
    await expect(materialization).rejects.toThrow('cancelled');
    expect(Boolean(lstatSync(contextDirectory, LSTAT_MISSING_OPTIONS))).toBe(
      false,
    );
    expect(closureTemporaryDirectories()).toEqual(before);
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('rejects forbidden capabilities in recursively imported sources', async () => {
  const repositoryRoot = createClosureRepository();
  try {
    const dependencyPath = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/src/dependency.ts',
    );
    writeFileSync(
      dependencyPath,
      "import { writeFile } from 'node:fs';\nvoid writeFile;\n",
    );
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['add', '.'], gitOptions);
    const closureRequest = closureRequestFor(repositoryRoot);
    await expect(materializeSkillClosure(closureRequest)).rejects.toThrow(
      'forbidden ambient module',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('rejects dynamic and missing local modules from the closure', async () => {
  for (const source of [
    "await import('./dependency.ts');\n",
    "import './missing.ts';\n",
  ]) {
    const repositoryRoot = createClosureRepository(source);
    try {
      const closureRequest = closureRequestFor(repositoryRoot);
      await expect(materializeSkillClosure(closureRequest)).rejects.toThrow();
    } finally {
      rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
    }
  }
});

test('enforces exact aggregate closure file and edge bounds', async () => {
  const repositoryRoot = createClosureRepository();
  try {
    const sourceRoot = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/src',
    );
    const imports: string[] = [];
    for (let index = 0; index < 124; index += 1) {
      const name = `dependency-${index}.ts`;
      imports.push(`import './${name}';`);
      writeFileSync(path.join(sourceRoot, name), 'export {};\n');
    }
    writeFileSync(
      path.join(sourceRoot, 'runner.ts'),
      `${imports.join('\n')}\n`,
    );
    rmSync(path.join(sourceRoot, 'dependency.ts'));
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['add', '.'], gitOptions);
    const exactRequest = closureRequestFor(repositoryRoot);
    const closure = await materializeSkillClosure(exactRequest);
    closure.dispose();

    writeFileSync(path.join(sourceRoot, 'dependency-124.ts'), 'export {};\n');
    writeFileSync(
      path.join(sourceRoot, 'runner.ts'),
      `${imports.join('\n')}\nimport './dependency-124.ts';\n`,
    );
    execFileSync('git', ['add', '.'], gitOptions);
    const overFileRequest = closureRequestFor(repositoryRoot);
    await expect(materializeSkillClosure(overFileRequest)).rejects.toThrow(
      'file count limit',
    );

    const repeatedImports = new Array<string>(
      EXECUTABLE_SKILL_CLOSURE_LIMITS.edges + 1,
    ).fill("import './dependency-0.ts';");
    writeFileSync(
      path.join(sourceRoot, 'runner.ts'),
      `${repeatedImports.join('\n')}\n`,
    );
    rmSync(path.join(sourceRoot, 'dependency-124.ts'));
    execFileSync('git', ['add', '.'], gitOptions);
    const overEdgeRequest = closureRequestFor(repositoryRoot);
    await expect(materializeSkillClosure(overEdgeRequest)).rejects.toThrow(
      'import edge limit',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('enforces the aggregate closure byte bound plus one', async () => {
  const repositoryRoot = createClosureRepository("import './dependency.ts';\n");
  try {
    const skillRoot = path.join(repositoryRoot, '.agents/skills/stub-skill');
    const dependencyPath = path.join(skillRoot, 'src/dependency.ts');
    const fixedPaths = [
      path.join(skillRoot, 'src/runner.ts'),
      path.join(skillRoot, 'executable-skill.json'),
      path.join(repositoryRoot, '.agents/skills/package.json'),
      path.join(repositoryRoot, '.agents/skills/bun.lock'),
    ];
    let fixedBytes = 0;
    for (const filePath of fixedPaths) {
      fixedBytes += Buffer.byteLength(readFileSync(filePath, 'utf8'), 'utf8');
    }
    writeFileSync(
      dependencyPath,
      ' '.repeat(EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes - fixedBytes),
    );
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['add', '.'], gitOptions);
    const exactRequest = closureRequestFor(repositoryRoot);
    const closure = await materializeSkillClosure(exactRequest);
    closure.dispose();

    writeFileSync(
      dependencyPath,
      ' '.repeat(EXECUTABLE_SKILL_CLOSURE_LIMITS.bytes - fixedBytes + 1),
    );
    execFileSync('git', ['add', '.'], gitOptions);
    const overByteRequest = closureRequestFor(repositoryRoot);
    await expect(materializeSkillClosure(overByteRequest)).rejects.toThrow(
      'aggregate byte limit',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

function closureTemporaryDirectories(): readonly string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('nook-skill-closure-'))
    .sort();
}

type WaitForClosureContextRequest = {
  readonly existingNames: ReadonlySet<string>;
  readonly timeoutMs: number;
};

async function waitForClosureContext(
  request: WaitForClosureContextRequest,
): Promise<string> {
  const deadline = Date.now() + request.timeoutMs;
  while (Date.now() < deadline) {
    for (const name of closureTemporaryDirectories()) {
      if (!request.existingNames.has(name)) return path.join(tmpdir(), name);
    }
    await Bun.sleep(1);
  }
  throw new Error('Closure context did not become observable.');
}

function closureDefinition(): RegisteredExecutableSkill {
  return {
    skillId: 'stub-skill',
    manifest: baseManifest,
    manifestPath: '.agents/skills/stub-skill/executable-skill.json',
    resultContract: ExecutableSkillHostResultContract.CortexArticleStructureV1,
    runnerPath: '.agents/skills/stub-skill/src/runner.ts',
  };
}

function closureRequestFor(
  repositoryRoot: string,
): MaterializeSkillClosureRequest {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    definition: closureDefinition(),
    repositoryRoot,
    signal: false,
  };
}

function createClosureRepository(
  runnerSource = "import { value } from './dependency.ts';\nvoid value;\n",
): string {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'executable-skill-closure-'),
  );
  const skillsRoot = path.join(repositoryRoot, '.agents/skills');
  const skillRoot = path.join(skillsRoot, 'stub-skill');
  mkdirSync(path.join(skillRoot, 'src'), CREATE_TREE_OPTIONS);
  writeFileSync(
    path.join(skillRoot, 'executable-skill.json'),
    JSON.stringify(baseManifest),
  );
  writeFileSync(path.join(skillRoot, 'src/runner.ts'), runnerSource);
  writeFileSync(
    path.join(skillRoot, 'src/dependency.ts'),
    "export const value = 'sealed dependency';\n",
  );
  const packageValue = { name: 'closure-fixture', dependencies: {} };
  writeFileSync(
    path.join(skillsRoot, 'package.json'),
    JSON.stringify(packageValue),
  );
  writeFileSync(path.join(skillsRoot, 'bun.lock'), 'lockfileVersion = 1\n');
  const gitOptions = { cwd: repositoryRoot };
  execFileSync('git', ['init', '--quiet'], gitOptions);
  execFileSync('git', ['add', '.'], gitOptions);
  return repositoryRoot;
}
