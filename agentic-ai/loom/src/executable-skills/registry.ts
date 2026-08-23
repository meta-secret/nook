import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  ExecutableSkillExecutionKind,
  ExecutableSkillHostResultContract,
  ExecutableSkillRegistryFindingCode,
} from './domain.ts';
import type {
  AuditExecutableSkillRegistryRequest,
  ExecutableSkillManifest,
  ExecutableSkillRegistryFinding,
  RegisteredExecutableSkill,
} from './domain.ts';
import {
  CORTEX_ARTICLE_RESULT_KIND,
  decodeCortexArticleResult,
} from './cortex-article-transport.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';

const CORTEX_ARTICLE_POLICY =
  '.cortex/dynamic-skills/cortex-article-structure.md';
const cortexArticleLimits = {
  requestBytes: 4 * 1024 * 1024,
  resultBytes: 1024 * 1024,
  timeoutMs: 120000,
};
const cortexArticleManifest: ExecutableSkillManifest = {
  schemaVersion: 1,
  id: 'cortex-article-structure',
  executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
  requestKind: 'cortex-article-structure-audit-v1',
  resultKind: 'cortex-article-structure-findings-v1',
  policyPaths: Object.freeze([CORTEX_ARTICLE_POLICY]),
  limits: Object.freeze(cortexArticleLimits),
};
const CORTEX_ARTICLE_MANIFEST = Object.freeze(cortexArticleManifest);
const executableSkillEntries: readonly RegisteredExecutableSkill[] = [
  {
    skillId: 'cortex-article-structure',
    manifest: CORTEX_ARTICLE_MANIFEST,
    manifestPath:
      '.agents/skills/cortex-article-structure/executable-skill.json',
    resultContract: ExecutableSkillHostResultContract.CortexArticleStructureV1,
    runnerPath: '.agents/skills/cortex-article-structure/src/runner.ts',
  },
] as const;

export const EXECUTABLE_SKILL_REGISTRY: ReadonlyMap<
  string,
  RegisteredExecutableSkill
> = createExecutableSkillRegistry(executableSkillEntries);

export type ValidateRegisteredExecutableSkillResultRequest = {
  readonly registration: RegisteredExecutableSkill;
  readonly serializedResult: string;
};

export function validateRegisteredExecutableSkillResult(
  request: ValidateRegisteredExecutableSkillResultRequest,
): void {
  switch (request.registration.resultContract) {
    case ExecutableSkillHostResultContract.CortexArticleStructureV1: {
      if (
        request.registration.manifest.resultKind !== CORTEX_ARTICLE_RESULT_KIND
      ) {
        throw new Error('Executable skill host result contract kind mismatch.');
      }
      decodeCortexArticleResult(request.serializedResult);
      return;
    }
    default:
      throw new Error('Executable skill host result contract is unsupported.');
  }
}

const FORBIDDEN_SOURCE_PATTERNS = [
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]node:(?:child_process|cluster|dgram|dns|fs|http|https|net|tls|worker_threads)['"]/u,
  /\b(?:fetch|WebSocket)\s*\(/u,
  /\bBun\.(?:file|serve|spawn|spawnSync)\b/u,
  /\bBun\.write\s*\((?!\s*Bun\.stdout\b)/u,
  /\bprocess\.(?:chdir|cwd|env|execArgv|kill)\b/u,
] as const;

export function auditExecutableSkillRegistry(
  request: AuditExecutableSkillRegistryRequest,
): readonly ExecutableSkillRegistryFinding[] {
  const findings: ExecutableSkillRegistryFinding[] = [];
  const registeredIds = new Set(EXECUTABLE_SKILL_REGISTRY.keys());
  const manifestIds = new Set<string>();
  const skillsRoot = path.join(request.repositoryRoot, '.agents', 'skills');
  const directoryReadOptions = { withFileTypes: true } as const;
  for (const entry of readdirSync(skillsRoot, directoryReadOptions)) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(
      skillsRoot,
      entry.name,
      'executable-skill.json',
    );
    let manifest: ExecutableSkillManifest;
    try {
      manifest = decodeExecutableSkillManifest(
        readFileSync(manifestPath, 'utf8'),
      );
      manifestIds.add(manifest.id);
    } catch {
      if (isFilesystemEntry(manifestPath)) {
        const invalidManifestFinding: ExecutableSkillRegistryFinding = {
          code: ExecutableSkillRegistryFindingCode.InvalidManifest,
          skillId: entry.name,
          message: 'Executable skill manifest is invalid.',
        };
        findings.push(registryFinding(invalidManifestFinding));
      }
      continue;
    }
    const registration = EXECUTABLE_SKILL_REGISTRY.get(manifest.id);
    const relativeManifestPath = path.relative(
      request.repositoryRoot,
      manifestPath,
    );
    if (
      manifest.id !== entry.name ||
      !registration ||
      registration.manifestPath !== relativeManifestPath ||
      JSON.stringify(registration.manifest) !== JSON.stringify(manifest)
    ) {
      const driftFinding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.InvalidManifest,
        skillId: entry.name,
        message:
          'Executable skill manifest differs from its exact static registration.',
      };
      findings.push(registryFinding(driftFinding));
      continue;
    }
    const boundPaths = [
      registration.manifestPath,
      registration.runnerPath,
      ...registration.manifest.policyPaths,
    ];
    for (const relativePath of boundPaths) {
      const fileRequest: AuditBoundFileRequest = {
        relativePath,
        repositoryRoot: request.repositoryRoot,
        skillId: entry.name,
      };
      findings.push(...auditBoundFile(fileRequest));
    }
    const sourceRequest: AuditSkillSourceRequest = {
      repositoryRoot: request.repositoryRoot,
      skillId: entry.name,
    };
    findings.push(...auditSkillSource(sourceRequest));
  }
  for (const registeredId of registeredIds) {
    if (!manifestIds.has(registeredId)) {
      const unexpectedFinding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.UnexpectedRegistration,
        skillId: registeredId,
        message: 'Registered executable skill has no valid manifest.',
      };
      findings.push(registryFinding(unexpectedFinding));
    }
  }
  for (const manifestId of manifestIds) {
    if (!registeredIds.has(manifestId)) {
      const missingFinding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.MissingRegistration,
        skillId: manifestId,
        message: 'Executable skill manifest has no static registration.',
      };
      findings.push(registryFinding(missingFinding));
    }
  }
  return findings;
}

type RegistryFindingRequest = ExecutableSkillRegistryFinding;

function registryFinding(
  request: RegistryFindingRequest,
): ExecutableSkillRegistryFinding {
  return request;
}

type AuditBoundFileRequest = {
  readonly relativePath: string;
  readonly repositoryRoot: string;
  readonly skillId: string;
};

function auditBoundFile(
  request: AuditBoundFileRequest,
): readonly ExecutableSkillRegistryFinding[] {
  const absolutePath = path.join(request.repositoryRoot, request.relativePath);
  try {
    const resolvedRoot = `${realpathSync(request.repositoryRoot)}${path.sep}`;
    const resolvedPath = realpathSync(absolutePath);
    const stat = lstatSync(absolutePath);
    if (
      !resolvedPath.startsWith(resolvedRoot) ||
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      !isRepositoryOwnedFile(request)
    ) {
      throw new Error('unsafe executable-skill file');
    }
    return [];
  } catch {
    const unsafeFileFinding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnsafeFile,
      skillId: request.skillId,
      message:
        'Registered executable skill path is not a regular repository-owned file: ' +
        request.relativePath,
    };
    return [registryFinding(unsafeFileFinding)];
  }
}

function isRepositoryOwnedFile(request: AuditBoundFileRequest): boolean {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: request.repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  const args = ['ls-files', '--error-unmatch', '--', request.relativePath];
  const output = execFileSync('git', args, options);
  return output.trim() === request.relativePath;
}

type AuditSkillSourceRequest = {
  readonly repositoryRoot: string;
  readonly skillId: string;
};

function auditSkillSource(
  request: AuditSkillSourceRequest,
): readonly ExecutableSkillRegistryFinding[] {
  const sourceRoot = path.join(
    request.repositoryRoot,
    '.agents',
    'skills',
    request.skillId,
    'src',
  );
  const findings: ExecutableSkillRegistryFinding[] = [];
  let sourceNames: string[];
  try {
    sourceNames = readdirSync(sourceRoot).sort();
  } catch {
    const missingSourceFinding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnsafeFile,
      skillId: request.skillId,
      message: 'Executable skill source directory is missing or unreadable.',
    };
    return [registryFinding(missingSourceFinding)];
  }
  for (const name of sourceNames) {
    if (!name.endsWith('.ts')) continue;
    const relativePath = path.posix.join(
      '.agents',
      'skills',
      request.skillId,
      'src',
      name,
    );
    const fileRequest: AuditBoundFileRequest = {
      relativePath,
      repositoryRoot: request.repositoryRoot,
      skillId: request.skillId,
    };
    const fileFindings = auditBoundFile(fileRequest);
    findings.push(...fileFindings);
    if (fileFindings.length > 0) continue;
    let source: string;
    try {
      source = readFileSync(path.join(sourceRoot, name), 'utf8');
    } catch {
      const unreadableFinding: ExecutableSkillRegistryFinding = {
        code: ExecutableSkillRegistryFindingCode.UnsafeFile,
        skillId: request.skillId,
        message: `Executable skill source is not a readable regular file: src/${name}`,
      };
      findings.push(registryFinding(unreadableFinding));
      continue;
    }
    if (!FORBIDDEN_SOURCE_PATTERNS.some((pattern) => pattern.test(source))) {
      continue;
    }
    const capabilityFinding: ExecutableSkillRegistryFinding = {
      code: ExecutableSkillRegistryFindingCode.UnsafeCapability,
      skillId: request.skillId,
      message:
        'Executable skill source requests a forbidden ambient capability: ' +
        `src/${name}`,
    };
    findings.push(registryFinding(capabilityFinding));
  }
  return findings;
}

function isFilesystemEntry(filePath: string): boolean {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function createExecutableSkillRegistry(
  entries: readonly RegisteredExecutableSkill[],
): ReadonlyMap<string, RegisteredExecutableSkill> {
  const registry = new Map<string, RegisteredExecutableSkill>();
  for (const entry of entries) {
    if (registry.has(entry.skillId)) {
      throw new Error(`Duplicate executable skill ID: ${entry.skillId}`);
    }
    registry.set(entry.skillId, Object.freeze(entry));
  }
  return registry;
}
