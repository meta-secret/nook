import { execFileSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, setDefaultTimeout, test } from 'bun:test';
import { CortexArticleContractKind } from '../../../.agents/skills/cortex-article-structure/src/domain.ts';
import {
  ExecutableSkillExecutionKind,
  ExecutableSkillHostResultContract,
  ExecutableSkillRegistryFindingCode,
} from '../src/executable-skills/domain.ts';
import type {
  ExecuteRegisteredSkillRequest,
  ExecutableSkillManifest,
  RegisteredExecutableSkill,
} from '../src/executable-skills/domain.ts';
import {
  materializeSkillClosure,
  type MaterializeSkillClosureRequest,
} from '../src/executable-skills/closure.ts';
import {
  CortexArticleFindingCode,
  decodeCortexArticleResult,
  encodeCortexArticleRequest,
  type EncodeCortexArticleRequestArgs,
} from '../src/executable-skills/cortex-article-transport.ts';
import { decodeExecutableSkillManifest } from '../src/executable-skills/manifest-codec.ts';
import {
  auditExecutableSkillRegistry,
  EXECUTABLE_SKILL_REGISTRY,
  validateRegisteredExecutableSkillResult,
  type ValidateRegisteredExecutableSkillResultRequest,
} from '../src/executable-skills/registry.ts';
import {
  ExecutableSkillAcceptanceProbe,
  ExecutableSkillTimeoutError,
  executeExecutableSkillAcceptanceProbe,
  executeRegisteredSkill,
} from '../src/executable-skills/runtime.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const POLICY_PATH = '.cortex/dynamic-skills/cortex-article-structure.md';
const LSTAT_MISSING_OPTIONS: { readonly throwIfNoEntry: false } = {
  throwIfNoEntry: false,
};
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;
const CREATE_TREE_OPTIONS = { recursive: true } as const;
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

test('decodes only exact bounded Docker manifests', () => {
  expect(decodeExecutableSkillManifest(JSON.stringify(baseManifest))).toEqual(
    baseManifest,
  );
  const unsafeManifest = { ...baseManifest, command: 'bun arbitrary.ts' };
  expect(() =>
    decodeExecutableSkillManifest(JSON.stringify(unsafeManifest)),
  ).toThrow('Invalid executable skill manifest');
  const outsideCortex = {
    ...baseManifest,
    policyPaths: ['README.md'],
  };
  expect(() =>
    decodeExecutableSkillManifest(JSON.stringify(outsideCortex)),
  ).toThrow('Invalid executable skill manifest');
  const dotAlias = {
    ...baseManifest,
    policyPaths: ['.cortex/./policy.md'],
  };
  expect(() => decodeExecutableSkillManifest(JSON.stringify(dotAlias))).toThrow(
    'Invalid executable skill manifest',
  );
});

test('executes and verifies the registered skill in the pinned container', async () => {
  const serializedRequestValue = {
    kind: CortexArticleContractKind.Request,
    documents: [],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  const request: ExecuteRegisteredSkillRequest = {
    skillId: 'cortex-article-structure',
    serializedRequest: JSON.stringify(serializedRequestValue),
  };
  const result = await executeRegisteredSkill(request);
  expect(result.executionKind).toBe(
    ExecutableSkillExecutionKind.DockerReadOnly,
  );
  expect(result.resultContract).toBe(
    ExecutableSkillHostResultContract.CortexArticleStructureV1,
  );
  expect(result.requestSha256).toHaveLength(64);
  expect(result.resultSha256).toHaveLength(64);
  expect(result.closureSha256).toHaveLength(64);
  expect(result.runtimeImageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(result.sourceTree).toMatch(/^[0-9a-f]{40,64}$/u);
});

test('host transport matches the isolated request and result contract', () => {
  const articleRequest: EncodeCortexArticleRequestArgs = {
    documents: [
      {
        relativePath: '.cortex/example.md',
        content: '# Example\n',
      },
    ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  const serializedRequest = encodeCortexArticleRequest(articleRequest);
  const expectedRequest = {
    kind: 'cortex-article-structure-audit-v1',
    documents: [
      {
        relativePath: '.cortex/example.md',
        content: '# Example\n',
      },
    ],
    migrationBaselineEntries: false,
    migrationLedger: {
      relativePath: '.cortex/article-structure-migration.txt',
      content: false,
    },
  };
  expect(JSON.parse(serializedRequest)).toEqual(expectedRequest);
  const resultValue = {
    kind: 'cortex-article-structure-findings-v1',
    findings: [
      {
        code: CortexArticleFindingCode.EmptyArticle,
        file: '.cortex/example.md',
        line: 1,
        message: 'The article is empty.',
      },
    ],
  };
  const serializedResult = JSON.stringify(resultValue);
  expect(decodeCortexArticleResult(serializedResult)).toHaveLength(1);
  const extraResult = {
    kind: 'cortex-article-structure-findings-v1',
    findings: [],
    authority: true,
  };
  const serializedExtraResult = JSON.stringify(extraResult);
  expect(() => decodeCortexArticleResult(serializedExtraResult)).toThrow(
    'Invalid executable Cortex article result',
  );
});

test('rejects malformed or wrong-kind results before trust promotion', () => {
  const registration = EXECUTABLE_SKILL_REGISTRY.get(
    'cortex-article-structure',
  );
  if (!registration) throw new Error('Missing executable skill registration.');
  const wrongKindResult = { kind: 'wrong-result-kind', findings: [] };
  const malformedFindingsResult = {
    kind: 'cortex-article-structure-findings-v1',
    findings: 'not-an-array',
  };
  const extraAuthorityResult = {
    kind: 'cortex-article-structure-findings-v1',
    findings: [],
    forgedAuthority: true,
  };
  const adversarialResults = [
    'not-json',
    JSON.stringify(wrongKindResult),
    JSON.stringify(malformedFindingsResult),
    JSON.stringify(extraAuthorityResult),
  ];
  for (const serializedResult of adversarialResults) {
    const validationRequest: ValidateRegisteredExecutableSkillResultRequest = {
      registration,
      serializedResult,
    };
    expect(() =>
      validateRegisteredExecutableSkillResult(validationRequest),
    ).toThrow();
  }
  const validResultValue = {
    kind: 'cortex-article-structure-findings-v1',
    findings: [],
  };
  const validResult = JSON.stringify(validResultValue);
  const validRequest: ValidateRegisteredExecutableSkillResultRequest = {
    registration,
    serializedResult: validResult,
  };
  expect(() =>
    validateRegisteredExecutableSkillResult(validRequest),
  ).not.toThrow();
  const mismatchedManifest = {
    ...registration.manifest,
    resultKind: 'forged-result-kind',
  };
  const mismatchedRegistration: RegisteredExecutableSkill = {
    ...registration,
    manifest: mismatchedManifest,
  };
  const mismatchedRequest: ValidateRegisteredExecutableSkillResultRequest = {
    registration: mismatchedRegistration,
    serializedResult: validResult,
  };
  expect(() =>
    validateRegisteredExecutableSkillResult(mismatchedRequest),
  ).toThrow('contract kind mismatch');
});

test('materializes an immutable recursive staged skill closure', () => {
  const repositoryRoot = createClosureRepository();
  try {
    const definition = closureDefinition();
    const closureRequest: MaterializeSkillClosureRequest = {
      definition,
      repositoryRoot,
    };
    const closure = materializeSkillClosure(closureRequest);
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
      closure.dispose();
    }

    const dependencyPath = path.join(
      repositoryRoot,
      '.agents/skills/stub-skill/src/dependency.ts',
    );
    writeFileSync(dependencyPath, "export const value = 'worktree drift';\n");
    expect(() => materializeSkillClosure(closureRequest)).toThrow(
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
    expect(() => materializeSkillClosure(closureRequest)).toThrow(
      'worktree/index drift',
    );
    writeFileSync(manifestPath, JSON.stringify(baseManifest));
    const lockPath = path.join(repositoryRoot, '.agents/skills/bun.lock');
    writeFileSync(lockPath, 'lockfileVersion = 2\n');
    expect(() => materializeSkillClosure(closureRequest)).toThrow(
      'worktree/index drift',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('rejects forbidden capabilities in recursively imported sources', () => {
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
    const closureRequest: MaterializeSkillClosureRequest = {
      definition: closureDefinition(),
      repositoryRoot,
    };
    expect(() => materializeSkillClosure(closureRequest)).toThrow(
      'forbids ambient module',
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('rejects dynamic and missing local modules from the closure', () => {
  for (const source of [
    "await import('./dependency.ts');\n",
    "import './missing.ts';\n",
  ]) {
    const repositoryRoot = createClosureRepository(source);
    try {
      const closureRequest: MaterializeSkillClosureRequest = {
        definition: closureDefinition(),
        repositoryRoot,
      };
      expect(() => materializeSkillClosure(closureRequest)).toThrow();
    } finally {
      rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
    }
  }
});

test('container denies repository writes and network access', async () => {
  const result = await executeExecutableSkillAcceptanceProbe(
    ExecutableSkillAcceptanceProbe.Containment,
  );
  const expectedContainment = {
    networkBlocked: true,
    writeBlocked: true,
  };
  expect(JSON.parse(result.serializedOutput)).toEqual(expectedContainment);
  const forbiddenFile = lstatSync(
    path.join(
      REPOSITORY_ROOT,
      '.agents/skills/cortex-article-structure/forbidden.txt',
    ),
    LSTAT_MISSING_OPTIONS,
  );
  expect(Boolean(forbiddenFile)).toBe(false);
});

test('deadline covers verification and removes the killed container', async () => {
  let timeout: ExecutableSkillTimeoutError | false = false;
  try {
    await executeExecutableSkillAcceptanceProbe(
      ExecutableSkillAcceptanceProbe.Timeout,
    );
  } catch (error) {
    if (error instanceof ExecutableSkillTimeoutError) timeout = error;
  }
  expect(timeout).not.toBe(false);
  if (timeout === false) return;
  const inspect = Bun.spawnSync([
    'docker',
    'container',
    'inspect',
    timeout.containerName,
  ]);
  expect(inspect.exitCode).not.toBe(0);
});

test('kills a container whose stdout exceeds the result bound', async () => {
  await expect(
    executeExecutableSkillAcceptanceProbe(
      ExecutableSkillAcceptanceProbe.Overflow,
    ),
  ).rejects.toThrow('output exceeds');
});

test('fails closed for unknown skills and oversized requests', async () => {
  const unknownRequest: ExecuteRegisteredSkillRequest = {
    skillId: 'missing-skill',
    serializedRequest: '{}',
  };
  await expect(executeRegisteredSkill(unknownRequest)).rejects.toThrow(
    'Unregistered executable skill',
  );
  const oversizedRequest: ExecuteRegisteredSkillRequest = {
    skillId: 'cortex-article-structure',
    serializedRequest: 'x'.repeat(4 * 1024 * 1024 + 1),
  };
  await expect(executeRegisteredSkill(oversizedRequest)).rejects.toThrow(
    'request exceeds',
  );
});

test('audits exact manifest, runner, policy, tracking, and capabilities', () => {
  const repositoryRoot = createAuditRepository();
  try {
    const auditRequest = { repositoryRoot };
    expect(auditExecutableSkillRegistry(auditRequest)).toEqual([]);

    const manifestPath = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/executable-skill.json',
    );
    const originalManifest = readFileSync(manifestPath, 'utf8');
    const mutatedManifest = JSON.parse(
      originalManifest,
    ) as ExecutableSkillManifest;
    const mutatedLimits = { ...mutatedManifest.limits, timeoutMs: 4999 };
    const driftedManifest = { ...mutatedManifest, limits: mutatedLimits };
    writeFileSync(manifestPath, JSON.stringify(driftedManifest));
    expect(
      auditExecutableSkillRegistry(auditRequest).map((entry) => entry.code),
    ).toContain(ExecutableSkillRegistryFindingCode.InvalidManifest);
    writeFileSync(manifestPath, originalManifest);

    const policyPath = path.join(repositoryRoot, POLICY_PATH);
    const originalPolicy = readFileSync(policyPath, 'utf8');
    rmSync(policyPath);
    expect(
      auditExecutableSkillRegistry(auditRequest).map((entry) => entry.code),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
    symlinkSync('/tmp/outside-policy.md', policyPath);
    expect(
      auditExecutableSkillRegistry(auditRequest).map((entry) => entry.code),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
    rmSync(policyPath);
    writeFileSync(policyPath, originalPolicy);

    const runnerPath = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/src/runner.ts',
    );
    writeFileSync(runnerPath, "await fetch('https://example.com');\n");
    expect(
      auditExecutableSkillRegistry(auditRequest).map((entry) => entry.code),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeCapability);

    rmSync(runnerPath);
    symlinkSync('/tmp/outside-runner.ts', runnerPath);
    expect(
      auditExecutableSkillRegistry(auditRequest).map((entry) => entry.code),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repositoryRoot, removeOptions);
  }
});

function createAuditRepository(): string {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), 'executable-skill-registry-'),
  );
  const skillRoot = path.join(
    repositoryRoot,
    '.agents/skills/cortex-article-structure',
  );
  const createTreeOptions = { recursive: true } as const;
  mkdirSync(path.join(skillRoot, 'src'), createTreeOptions);
  mkdirSync(
    path.join(repositoryRoot, '.cortex/dynamic-skills'),
    createTreeOptions,
  );
  cpSync(
    path.join(
      REPOSITORY_ROOT,
      '.agents/skills/cortex-article-structure/executable-skill.json',
    ),
    path.join(skillRoot, 'executable-skill.json'),
  );
  cpSync(
    path.join(
      REPOSITORY_ROOT,
      '.agents/skills/cortex-article-structure/src/runner.ts',
    ),
    path.join(skillRoot, 'src/runner.ts'),
  );
  writeFileSync(
    path.join(repositoryRoot, POLICY_PATH),
    '# Cortex article structure\n',
  );
  const gitOptions = { cwd: repositoryRoot };
  execFileSync('git', ['init', '--quiet'], gitOptions);
  execFileSync('git', ['add', '.'], gitOptions);
  return repositoryRoot;
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
