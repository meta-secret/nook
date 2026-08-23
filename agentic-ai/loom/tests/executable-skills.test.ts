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
  ExecutableSkillManifest,
  RegisteredExecutableSkill,
} from '../src/executable-skills/domain.ts';
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
  ExecutableSkillRegistryInspectionKind,
  inspectExecutableSkillRegistry,
  validateRegisteredExecutableSkillResult,
  type AuditedExecutableSkillRegistry,
  type ValidateRegisteredExecutableSkillResultRequest,
} from '../src/executable-skills/registry.ts';
import {
  ExecutableSkillAcceptanceProbe,
  executeExecutableSkillAcceptanceProbe,
} from '../src/executable-skills/acceptance-runtime.ts';
import {
  ExecutableSkillCancellationError,
  ExecutableSkillTimeoutError,
  executeRegisteredSkill,
  type ExecuteRegisteredSkillRequest,
  resolveDockerControlEnvironment,
} from '../src/executable-skills/runtime.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');
const POLICY_PATH = '.cortex/dynamic-skills/cortex-article-structure.md';
const LSTAT_MISSING_OPTIONS: { readonly throwIfNoEntry: false } = {
  throwIfNoEntry: false,
};
const REMOVE_TREE_OPTIONS = { recursive: true, force: true } as const;
const CREATE_TREE_OPTIONS = { recursive: true } as const;
const HOST_CREDENTIAL_NAME = 'NOOK_EXECUTABLE_SKILL_HOST_CREDENTIAL';
setDefaultTimeout(180_000);

async function executableSkillAuthority() {
  const inspectionRequest = registryAuditRequest(REPOSITORY_ROOT);
  const inspection = await inspectExecutableSkillRegistry(inspectionRequest);
  if (inspection.kind !== ExecutableSkillRegistryInspectionKind.Verified) {
    throw new Error('Executable skill test registry is invalid.');
  }
  return inspection.authority;
}

function registryAuditRequest(repositoryRoot: string) {
  return {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot,
    signal: false,
  } as const;
}

function currentIndexTree(): string {
  const treeOptions = { cwd: REPOSITORY_ROOT, encoding: 'utf8' } as const;
  return execFileSync('git', ['write-tree'], treeOptions).trim();
}

function currentIndexTreeFor(repositoryRoot: string): string {
  const treeOptions = { cwd: repositoryRoot, encoding: 'utf8' } as const;
  return execFileSync('git', ['write-tree'], treeOptions).trim();
}

function executableSkillContainersForTree(
  sourceTree: string,
): ReadonlySet<string> {
  const output = Bun.spawnSync([
    'docker',
    'container',
    'ls',
    '--all',
    '--filter',
    'name=^nook-skill-',
    '--filter',
    `label=nook.executable-skill-source-tree=${sourceTree}`,
    '--format',
    '{{.Names}}',
  ]);
  return new Set(output.stdout.toString().trim().split('\n').filter(Boolean));
}

type WaitForAcceptanceContainerRequest = {
  readonly existingContainers: ReadonlySet<string>;
  readonly sourceTree: string;
  readonly timeoutMs: number;
};

async function waitForAcceptanceContainer(
  request: WaitForAcceptanceContainerRequest,
): Promise<string> {
  const deadline = Date.now() + request.timeoutMs;
  while (Date.now() < deadline) {
    for (const name of executableSkillContainersForTree(request.sourceTree)) {
      if (!request.existingContainers.has(name)) return name;
    }
    await Bun.sleep(50);
  }
  throw new Error('Acceptance container did not become observable.');
}

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

test('preserves Docker connection selection while scrubbing other host state', () => {
  const environmentValues = {
    DOCKER_CERT_PATH: '/tmp/nook-docker-certs',
    DOCKER_CONFIG: '/tmp/nook-docker-config',
    DOCKER_CONTEXT: 'nook-test-context',
    DOCKER_HOST: 'unix:///tmp/nook-docker.sock',
    DOCKER_TLS: '1',
    DOCKER_TLS_VERIFY: '1',
    HOME: '/tmp/nook-docker-home',
    SSH_AUTH_SOCK: '/tmp/nook-ssh-agent.sock',
    [HOST_CREDENTIAL_NAME]: 'synthetic-secret',
  };
  const mutationRequest: ApplyHostEnvironmentRequest = {
    values: environmentValues,
  };
  const originalEnvironment = applyHostEnvironment(mutationRequest);
  try {
    const environment = resolveDockerControlEnvironment();
    expect(environment.DOCKER_CERT_PATH).toBe(
      environmentValues.DOCKER_CERT_PATH,
    );
    expect(environment.DOCKER_CONFIG).toBe(environmentValues.DOCKER_CONFIG);
    expect(environment.DOCKER_CONTEXT).toBe(environmentValues.DOCKER_CONTEXT);
    expect(environment.DOCKER_HOST).toBe(environmentValues.DOCKER_HOST);
    expect(environment.DOCKER_TLS).toBe(environmentValues.DOCKER_TLS);
    expect(environment.DOCKER_TLS_VERIFY).toBe(
      environmentValues.DOCKER_TLS_VERIFY,
    );
    expect(environment.HOME).toBe(environmentValues.HOME);
    expect(environment.SSH_AUTH_SOCK).toBe(environmentValues.SSH_AUTH_SOCK);
    expect(Object.hasOwn(environment, HOST_CREDENTIAL_NAME)).toBe(false);
  } finally {
    const restoreRequest: RestoreHostEnvironmentRequest = {
      values: originalEnvironment,
    };
    restoreHostEnvironment(restoreRequest);
  }
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
    registryAuthority: await executableSkillAuthority(),
    skillId: 'cortex-article-structure',
    serializedRequest: JSON.stringify(serializedRequestValue),
    signal: false,
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

test('container denies repository writes and network access', async () => {
  const dockerConfig = mkdtempSync(
    path.join(tmpdir(), 'nook-docker-proxy-config-'),
  );
  const proxySentinel = 'nook-host-proxy-credential';
  const proxyConfig = {
    proxies: {
      default: {
        allProxy: `socks5://${proxySentinel}`,
        ftpProxy: `http://${proxySentinel}`,
        httpProxy: `http://${proxySentinel}`,
        httpsProxy: `https://${proxySentinel}`,
        noProxy: proxySentinel,
      },
    },
  };
  writeFileSync(
    path.join(dockerConfig, 'config.json'),
    JSON.stringify(proxyConfig),
  );
  const probeRequest = {
    probe: ExecutableSkillAcceptanceProbe.Containment,
    rebuildImage: false,
    signal: false,
  } as const;
  await executeExecutableSkillAcceptanceProbe(probeRequest);
  const mutationRequest: ApplyHostEnvironmentRequest = {
    values: {
      [HOST_CREDENTIAL_NAME]: 'synthetic-host-credential',
      DOCKER_CONFIG: dockerConfig,
    },
  };
  const originalEnvironment = applyHostEnvironment(mutationRequest);
  try {
    const result = await executeExecutableSkillAcceptanceProbe(probeRequest);
    const containment = JSON.parse(result.serializedOutput);
    expect(containment.credentialAbsent).toBe(true);
    expect(containment.networkBlocked).toBe(true);
    expect(containment.writeBlocked).toBe(true);
    expect(Array.isArray(containment.environment)).toBe(true);
    expect(containment.environment.join('\n')).not.toContain(proxySentinel);
    expect(result.containerEnvironment.join('\n')).not.toContain(proxySentinel);
    const proxyVariables = [
      'ALL_PROXY',
      'FTP_PROXY',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
      'all_proxy',
      'ftp_proxy',
      'http_proxy',
      'https_proxy',
      'no_proxy',
    ];
    for (const variable of proxyVariables) {
      expect(result.containerEnvironment).toContain(`${variable}=`);
      expect(containment.environment).toContain(`${variable}=`);
    }
    const forbiddenFile = lstatSync(
      path.join(
        REPOSITORY_ROOT,
        '.agents/skills/cortex-article-structure/forbidden.txt',
      ),
      LSTAT_MISSING_OPTIONS,
    );
    expect(Boolean(forbiddenFile)).toBe(false);
  } finally {
    const restoreRequest: RestoreHostEnvironmentRequest = {
      values: originalEnvironment,
    };
    restoreHostEnvironment(restoreRequest);
    rmSync(dockerConfig, REMOVE_TREE_OPTIONS);
  }
});

test('cold provisioning precedes the execution timeout and teardown', async () => {
  let timeout: ExecutableSkillTimeoutError | false = false;
  try {
    const probeRequest = {
      probe: ExecutableSkillAcceptanceProbe.Timeout,
      rebuildImage: true,
      signal: false,
    } as const;
    await executeExecutableSkillAcceptanceProbe(probeRequest);
  } catch (error) {
    if (error instanceof ExecutableSkillTimeoutError) timeout = error;
  }
  expect(timeout).not.toBe(false);
  if (timeout === false) return;
  expect(timeout.coldImageProvisioned).toBe(true);
  const inspect = Bun.spawnSync([
    'docker',
    'container',
    'inspect',
    timeout.containerName,
  ]);
  expect(inspect.exitCode).not.toBe(0);
});

test('active cancellation removes the blocking container before settling', async () => {
  const controller = new AbortController();
  const probeRequest = {
    probe: ExecutableSkillAcceptanceProbe.Timeout,
    rebuildImage: false,
    signal: controller.signal,
  } as const;
  const sourceTree = currentIndexTree();
  const existingContainers = executableSkillContainersForTree(sourceTree);
  const execution = executeExecutableSkillAcceptanceProbe(probeRequest);
  const waitRequest: WaitForAcceptanceContainerRequest = {
    existingContainers,
    sourceTree,
    timeoutMs: 30_000,
  };
  const observedContainer = await waitForAcceptanceContainer(waitRequest);
  const identityInspection = Bun.spawnSync([
    'docker',
    'container',
    'inspect',
    '--format',
    '{{.Image}}|{{.Config.Image}}',
    observedContainer,
  ]);
  expect(identityInspection.exitCode).toBe(0);
  const [resolvedImage, configuredImage, extraImage] = identityInspection.stdout
    .toString()
    .trim()
    .split('|');
  expect(resolvedImage).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(configuredImage).toBe(resolvedImage);
  expect(typeof extraImage).not.toBe('string');
  const startedAt = Date.now();
  controller.abort();
  let cancellation: ExecutableSkillCancellationError | false = false;
  try {
    await execution;
  } catch (error) {
    if (error instanceof ExecutableSkillCancellationError) {
      cancellation = error;
    }
  }
  expect(cancellation).not.toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(10_000);
  if (cancellation === false || cancellation.containerName === false) return;
  expect(cancellation.containerName).toBe(observedContainer);
  const inspect = Bun.spawnSync([
    'docker',
    'container',
    'inspect',
    cancellation.containerName,
  ]);
  expect(inspect.exitCode).not.toBe(0);
});

test('pre-aborted execution is rejected before lifecycle start', async () => {
  const controller = new AbortController();
  controller.abort();
  const probeRequest = {
    probe: ExecutableSkillAcceptanceProbe.Containment,
    rebuildImage: false,
    signal: controller.signal,
  } as const;
  await expect(
    executeExecutableSkillAcceptanceProbe(probeRequest),
  ).rejects.toBeInstanceOf(ExecutableSkillCancellationError);
});

test('kills a container whose stdout exceeds the result bound', async () => {
  const probeRequest = {
    probe: ExecutableSkillAcceptanceProbe.Overflow,
    rebuildImage: false,
    signal: false,
  } as const;
  await expect(
    executeExecutableSkillAcceptanceProbe(probeRequest),
  ).rejects.toThrow('output exceeds');
});

test('fails closed for unknown skills and oversized requests', async () => {
  const unknownRequest: ExecuteRegisteredSkillRequest = {
    registryAuthority: await executableSkillAuthority(),
    skillId: 'missing-skill',
    serializedRequest: '{}',
    signal: false,
  };
  await expect(executeRegisteredSkill(unknownRequest)).rejects.toThrow(
    'Unregistered executable skill',
  );
  const oversizedRequest: ExecuteRegisteredSkillRequest = {
    registryAuthority: await executableSkillAuthority(),
    skillId: 'cortex-article-structure',
    serializedRequest: 'x'.repeat(4 * 1024 * 1024 + 1),
    signal: false,
  };
  await expect(executeRegisteredSkill(oversizedRequest)).rejects.toThrow(
    'request exceeds',
  );
});

test('execution is bound to the explicitly audited repository root', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    const inspectionRequest = registryAuditRequest(repositoryRoot);
    const inspection = await inspectExecutableSkillRegistry(inspectionRequest);
    expect(inspection.kind).toBe(
      ExecutableSkillRegistryInspectionKind.Verified,
    );
    if (inspection.kind !== ExecutableSkillRegistryInspectionKind.Verified) {
      return;
    }
    const auditedSourceTree = currentIndexTreeFor(repositoryRoot);
    const requestValue = {
      kind: CortexArticleContractKind.Request,
      documents: [],
      migrationBaselineEntries: false,
      migrationLedger: {
        relativePath: '.cortex/article-structure-migration.txt',
        content: false,
      },
    };
    const request: ExecuteRegisteredSkillRequest = {
      registryAuthority: inspection.authority,
      serializedRequest: JSON.stringify(requestValue),
      signal: false,
      skillId: 'cortex-article-structure',
    };
    const runnerPath = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/src/runner.ts',
    );
    const originalRunner = readFileSync(runnerPath, 'utf8');
    writeFileSync(runnerPath, `${originalRunner}\nvoid 0;\n`);
    const gitOptions = { cwd: repositoryRoot, encoding: 'utf8' } as const;
    execFileSync('git', ['add', '--', runnerPath], gitOptions);
    await expect(executeRegisteredSkill(request)).rejects.toThrow(
      'source tree changed after authorization',
    );
    writeFileSync(runnerPath, originalRunner);
    execFileSync('git', ['add', '--', runnerPath], gitOptions);
    const execution = await executeRegisteredSkill(request);
    expect(execution.sourceTree).toBe(auditedSourceTree);
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
  }
});

test('rejects forged audited repository authority', async () => {
  const forgedAuthority: AuditedExecutableSkillRegistry = {
    auditId: 'forged-authority',
  };
  const request: ExecuteRegisteredSkillRequest = {
    registryAuthority: forgedAuthority,
    serializedRequest: '{}',
    signal: false,
    skillId: 'cortex-article-structure',
  };
  await expect(executeRegisteredSkill(request)).rejects.toThrow(
    'authority is invalid',
  );
});

test('rejects a structurally rebound audited registry authority', async () => {
  const inspection = await inspectExecutableSkillRegistry(
    registryAuditRequest(REPOSITORY_ROOT),
  );
  if (inspection.kind !== ExecutableSkillRegistryInspectionKind.Verified) {
    throw new Error('Executable skill registry fixture is invalid.');
  }
  const reboundAuthority: AuditedExecutableSkillRegistry = {
    ...inspection.authority,
  };
  const request: ExecuteRegisteredSkillRequest = {
    registryAuthority: reboundAuthority,
    serializedRequest: '{}',
    signal: false,
    skillId: 'cortex-article-structure',
  };
  await expect(executeRegisteredSkill(request)).rejects.toThrow(
    'authority is invalid',
  );
});

test('registry inspection propagates abort and deadline bounds', async () => {
  const controller = new AbortController();
  controller.abort();
  const abortedRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    repositoryRoot: REPOSITORY_ROOT,
    signal: controller.signal,
  };
  await expect(inspectExecutableSkillRegistry(abortedRequest)).rejects.toThrow(
    'cancelled',
  );
  const expiredRequest = {
    deadlineExpiresAt: Date.now() - 1,
    repositoryRoot: REPOSITORY_ROOT,
    signal: false,
  } as const;
  await expect(inspectExecutableSkillRegistry(expiredRequest)).rejects.toThrow(
    'deadline expired',
  );
});

test('audits exact manifest, runner, policy, tracking, and capabilities', async () => {
  const repositoryRoot = createAuditRepository();
  try {
    const auditRequest = registryAuditRequest(repositoryRoot);
    expect(await auditExecutableSkillRegistry(auditRequest)).toEqual([]);

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
    const driftedManifestCodes = (
      await auditExecutableSkillRegistry(auditRequest)
    ).map((entry) => entry.code);
    expect(driftedManifestCodes).toContain(
      ExecutableSkillRegistryFindingCode.InvalidManifest,
    );
    expect(driftedManifestCodes).toContain(
      ExecutableSkillRegistryFindingCode.WorktreeDrift,
    );
    writeFileSync(manifestPath, originalManifest);

    rmSync(manifestPath);
    symlinkSync('/tmp/outside-executable-skill-manifest.json', manifestPath);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.WorktreeDrift);
    rmSync(manifestPath);
    writeFileSync(manifestPath, ' '.repeat(16 * 1024 + 1));
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.WorktreeDrift);
    rmSync(manifestPath);
    execFileSync('mkfifo', [manifestPath]);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.WorktreeDrift);
    rmSync(manifestPath);
    writeFileSync(manifestPath, originalManifest);

    const policyPath = path.join(repositoryRoot, POLICY_PATH);
    const originalPolicy = readFileSync(policyPath, 'utf8');
    rmSync(policyPath);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
    symlinkSync('/tmp/outside-policy.md', policyPath);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
    rmSync(policyPath);
    writeFileSync(policyPath, originalPolicy);

    const runnerPath = path.join(
      repositoryRoot,
      '.agents/skills/cortex-article-structure/src/runner.ts',
    );
    writeFileSync(runnerPath, "await fetch('https://example.com');\n");
    const gitOptions = { cwd: repositoryRoot };
    execFileSync('git', ['add', '.'], gitOptions);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeCapability);

    rmSync(runnerPath);
    symlinkSync('/tmp/outside-runner.ts', runnerPath);
    expect(
      (await auditExecutableSkillRegistry(auditRequest)).map(
        (entry) => entry.code,
      ),
    ).toContain(ExecutableSkillRegistryFindingCode.UnsafeFile);
  } finally {
    const removeOptions = { recursive: true, force: true } as const;
    rmSync(repositoryRoot, removeOptions);
  }
});

test('shared AST policy rejects forbidden forms in nested sources', async () => {
  const forbiddenSources = [
    "import fs from 'fs';\nvoid fs;\n",
    "await import('./dependency.ts');\n",
    "globalThis.fetch('https://example.com');\n",
    'const network = fetch;\nvoid network;\n',
    'process.cwd();\n',
    "process.getBuiltinModule('fs');\n",
    "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nload('node:child_process');\n",
    "import module from 'module';\nmodule.createRequire(import.meta.url)('child_process');\n",
    "import.meta.require('node:child_process');\n",
    "const load = import.meta.require;\nload('node:child_process');\n",
    "const metadata = import.meta;\nmetadata.require('node:child_process');\n",
    "import.meta['require']('node:child_process');\n",
    "const loaderMember = 'require';\nimport.meta[loaderMember]('node:child_process');\n",
    'const resolveModule = import.meta.resolve;\nvoid resolveModule;\n',
    "module.require('node:child_process');\n",
    "const load = module.require;\nload('node:child_process');\n",
    "const runtimeModule = module;\nruntimeModule.require('node:child_process');\n",
    "const load = require;\nload('node:child_process');\n",
    "import processRuntime from 'node:process';\nconst load = processRuntime.getBuiltinModule;\nload('node:child_process');\n",
    "import { getBuiltinModule as load } from 'process';\nload('child_process');\n",
    "eval('1 + 1');\n",
    "const execute = eval;\nexecute('1 + 1');\n",
    "Function('return 1')();\n",
    "new Function('return 1')();\n",
    "const Constructor = Function;\nnew Constructor('return 1')();\n",
    'const Constructor = ({}).constructor;\nvoid Constructor;\n',
    "const Constructor = ({})['constructor'];\nvoid Constructor;\n",
    "global.eval('1 + 1');\n",
    "self.Function('return 1')();\n",
    "Reflect.get(() => false, 'constructor')('return 1')();\n",
    'const Constructor = (() => false)[`constructor`];\nvoid Constructor;\n',
    "const { constructor: Constructor } = () => false;\nConstructor('return 1')();\n",
    "const key = 'constructor';\n(() => false)[key]('return 1')();\n",
    "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => false), 'constructor')?.value('return 1')();\n",
    "(async function* () {})['con' + 'structor']('return 1')();\n",
    "import vm from 'node:vm';\nnew vm.Script('1 + 1');\n",
    "import repl from 'repl';\nvoid repl;\n",
    "import inspector from 'node:inspector';\nvoid inspector;\n",
    "import { WASI } from 'node:wasi';\nvoid WASI;\n",
    'const compile = WebAssembly.compile;\nvoid compile;\n',
    "const schedule = setTimeout;\nschedule('1 + 1', 0);\n",
    "new Worker('data:text/javascript,postMessage(1)');\n",
    "new Worker('./worker.ts');\n",
    "const WorkerLauncher = Worker;\nnew WorkerLauncher('./worker.ts');\n",
    'void Worker;\n',
    "new SharedWorker('data:text/javascript,postMessage(1)');\n",
    "const SharedLauncher = SharedWorker;\nSharedLauncher('./worker.ts');\n",
    "new globalThis.Worker('./worker.ts');\n",
    "new self.Worker('./worker.ts');\n",
    "new window.Worker('./worker.ts');\n",
    "new globalThis['Worker']('./worker.ts');\n",
    "import { Worker as ThreadWorker } from 'node:worker_threads';\nnew ThreadWorker('./worker.ts');\n",
    "new Bun.Worker('./worker.ts');\n",
    'void Bun.env.SECRET;\n',
    'const runtime = Bun;\nvoid runtime;\n',
    "Bun.spawn(['true']);\n",
    "Bun.spawnSync(['true']);\n",
    'await Bun.$`echo forbidden`;\n',
    'const shell = Bun.$;\nvoid shell;\n',
    'void Bun.futureProcessLauncher;\n',
    "import { $ as shell } from 'bun';\nawait shell`echo forbidden`;\n",
    "import { spawn as launch } from 'bun';\nlaunch(['true']);\n",
    "import { spawnSync as launch } from 'bun';\nlaunch(['true']);\n",
    "import * as runtime from 'bun';\nruntime.spawn(['true']);\n",
    "import { dlopen } from 'bun:ffi';\nvoid dlopen;\n",
  ];
  for (const source of forbiddenSources) {
    const repositoryRoot = createAuditRepository();
    try {
      const nestedRoot = path.join(
        repositoryRoot,
        '.agents/skills/cortex-article-structure/src/nested',
      );
      mkdirSync(nestedRoot, CREATE_TREE_OPTIONS);
      writeFileSync(path.join(nestedRoot, 'forbidden.ts'), source);
      writeFileSync(
        path.join(
          repositoryRoot,
          '.agents/skills/cortex-article-structure/src/runner.ts',
        ),
        "import './nested/forbidden.ts';\n",
      );
      const gitOptions = { cwd: repositoryRoot };
      execFileSync('git', ['add', '.'], gitOptions);
      const auditRequest = registryAuditRequest(repositoryRoot);
      expect(
        (await auditExecutableSkillRegistry(auditRequest)).map(
          (finding) => finding.code,
        ),
      ).toContain(ExecutableSkillRegistryFindingCode.UnsafeCapability);
    } finally {
      rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
    }
  }
});

test('discovers manifests from one frozen index tree and reports worktree drift', async () => {
  const repositoryRoot = createAuditRepository();
  const gitOptions = { cwd: repositoryRoot } as const;
  const registeredManifest =
    '.agents/skills/cortex-article-structure/executable-skill.json';
  try {
    execFileSync(
      'git',
      ['rm', '--cached', '--quiet', '--', registeredManifest],
      gitOptions,
    );
    const stagedDeletedCodes = (
      await auditExecutableSkillRegistry(registryAuditRequest(repositoryRoot))
    ).map((finding) => finding.code);
    expect(stagedDeletedCodes).toContain(
      ExecutableSkillRegistryFindingCode.UnexpectedRegistration,
    );
    expect(stagedDeletedCodes).toContain(
      ExecutableSkillRegistryFindingCode.WorktreeDrift,
    );

    execFileSync('git', ['add', '--', registeredManifest], gitOptions);
    const unregisteredManifest =
      '.agents/skills/unregistered/executable-skill.json';
    const unregisteredPath = path.join(repositoryRoot, unregisteredManifest);
    mkdirSync(path.dirname(unregisteredPath), CREATE_TREE_OPTIONS);
    writeFileSync(unregisteredPath, '{}');
    execFileSync('git', ['add', '--', unregisteredManifest], gitOptions);
    rmSync(unregisteredPath);
    const unregisteredCodes = (
      await auditExecutableSkillRegistry(registryAuditRequest(repositoryRoot))
    ).map((finding) => finding.code);
    expect(unregisteredCodes).toContain(
      ExecutableSkillRegistryFindingCode.MissingRegistration,
    );
    expect(unregisteredCodes).toContain(
      ExecutableSkillRegistryFindingCode.WorktreeDrift,
    );
  } finally {
    rmSync(repositoryRoot, REMOVE_TREE_OPTIONS);
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
  mkdirSync(skillRoot, createTreeOptions);
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
  const copyTreeOptions = { recursive: true } as const;
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/cortex-article-structure/src'),
    path.join(skillRoot, 'src'),
    copyTreeOptions,
  );
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/package.json'),
    path.join(repositoryRoot, '.agents/skills/package.json'),
  );
  cpSync(
    path.join(REPOSITORY_ROOT, '.agents/skills/bun.lock'),
    path.join(repositoryRoot, '.agents/skills/bun.lock'),
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

type HostEnvironmentValues = Readonly<Record<string, string>>;
type HostEnvironmentSnapshot = Readonly<Record<string, string | false>>;

type ApplyHostEnvironmentRequest = {
  readonly values: HostEnvironmentValues;
};

function applyHostEnvironment(
  request: ApplyHostEnvironmentRequest,
): HostEnvironmentSnapshot {
  const snapshot: Record<string, string | false> = {};
  for (const [key, value] of Object.entries(request.values)) {
    const original = Bun.env[key];
    snapshot[key] = typeof original === 'string' ? original : false;
    Bun.env[key] = value;
  }
  return snapshot;
}

type RestoreHostEnvironmentRequest = {
  readonly values: HostEnvironmentSnapshot;
};

function restoreHostEnvironment(request: RestoreHostEnvironmentRequest): void {
  for (const [key, value] of Object.entries(request.values)) {
    if (value === false) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
}
