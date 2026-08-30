import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import path from 'node:path';
import {
  asUntrustedYamlNode,
  isRecord,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from '../lib/guards.ts';

export const EXECUTABLE_SKILL_FINDING_LIMIT = 100;
export const EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT = 32_768;
const FINDING_PATH_LIMIT = 512;
const FINDING_ISSUE_LIMIT = 512;
const CANONICAL_MODE = '100644';
const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const OWNER_ROOT =
  '\\.cortex/(?:gizmo|shared|teams/(?:ai|dev-core|security|sre|web-dev))/dynamic-skills';
const EXECUTABLE_PACKAGE_PATH = new RegExp(
  '^(\\.cortex/(?:[^/]+|teams/[^/]+)/dynamic-skills/([^/]+))(?:/SKILL\\.md|/scripts(?:/|$))',
  'u',
);
const DECLARED_OWNER_PATH = new RegExp(`^${OWNER_ROOT}/`, 'u');
const CONFIG_HASHES = {
  prettier: '5342eced2ab6be14cc6716a764019f8a037da054a5c10c5c69ed428a43f739cb',
  eslint: '041f64bd112d38d0cbff3acf6ef1f7ddf40e5329fa93c7e5c07720f0bd50c0a1',
  typescript:
    '28526bdfb8bdaba4bbe5eb8b4e45f47c3bbf966e99a42424e7e0573d1014c95a',
} as const;

const REQUIRED_PROJECT_FILES = [
  '.gitignore',
  '.prettierrc',
  'bun.lock',
  'eslint.config.js',
  'executable-skill.json',
  'package.json',
  'tsconfig.json',
] as const;

const PACKAGE_SCRIPTS = {
  check: 'tsc --noEmit',
  lint: 'eslint .',
  format:
    'prettier --write "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
  'format:check':
    'prettier --check "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
  test: 'bun test tests',
  verify:
    'bun run format:check && bun run lint && bun run check && bun test tests',
} as const;

export type TrackedRepositoryFile = {
  readonly mode: string;
  readonly path: string;
};

export type ExecutableSkillPackageFinding = {
  readonly path: string;
  readonly issue: string;
};

export type ExecutableSkillPackage = {
  readonly packageRoot: string;
  readonly scriptsRoot: string;
  readonly skillPath: string;
  readonly slug: string;
};

type FindingCollector = {
  readonly findings: ExecutableSkillPackageFinding[];
  bytes: number;
};

export type AuditExecutableSkillPackageFilesRequest = {
  readonly repoRoot: string;
  readonly tracked: readonly TrackedRepositoryFile[];
};

export type ExecutableSkillDependencyInspection = {
  readonly findings: readonly ExecutableSkillPackageFinding[];
  readonly npmPackages: readonly string[];
};

export function readTrackedRepositoryFiles(
  repoRoot: string,
): readonly TrackedRepositoryFile[] {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const output = execFileSync('git', ['ls-files', '--stage', '-z'], options);
  return output
    .split('\0')
    .filter((record) => record.length > 0)
    .map(parseTrackedRecord);
}

function parseTrackedRecord(record: string): TrackedRepositoryFile {
  const match = /^(\d{6}) [0-9a-f]+ (\d+)\t([\s\S]+)$/u.exec(record);
  const mode = match?.at(1);
  const stage = match?.at(2);
  const trackedPath = match?.at(3);
  if (
    typeof mode !== 'string' ||
    stage !== '0' ||
    typeof trackedPath !== 'string'
  ) {
    throw new Error('git ls-files returned an invalid tracked-file record');
  }
  return { mode, path: trackedPath };
}

export function executableSkillPackageFromPath(
  trackedPath: string,
): ExecutableSkillPackage | false {
  const match = EXECUTABLE_PACKAGE_PATH.exec(trackedPath);
  const packageRoot = match?.at(1);
  const slug = match?.at(2);
  if (typeof packageRoot !== 'string' || typeof slug !== 'string') return false;
  return {
    packageRoot,
    scriptsRoot: `${packageRoot}/scripts`,
    skillPath: `${packageRoot}/SKILL.md`,
    slug,
  };
}

export function executableSkillPackages(
  tracked: readonly TrackedRepositoryFile[],
): readonly ExecutableSkillPackage[] {
  const packages = new Map<string, ExecutableSkillPackage>();
  for (const file of tracked) {
    const skillPackage = executableSkillPackageFromPath(file.path);
    if (skillPackage !== false) {
      packages.set(skillPackage.packageRoot, skillPackage);
    }
  }
  return [...packages.keys()].sort().flatMap((packageRoot) => {
    const skillPackage = packages.get(packageRoot);
    return skillPackage ? [skillPackage] : [];
  });
}

export function auditTrackedExecutableSkillPackages(
  repoRoot: string,
): readonly ExecutableSkillPackageFinding[] {
  if (!existsSync(path.join(repoRoot, '.git'))) return [];
  const tracked = readTrackedRepositoryFiles(repoRoot);
  const request: AuditExecutableSkillPackageFilesRequest = {
    repoRoot,
    tracked,
  };
  return auditExecutableSkillPackageFiles(request);
}

export function inspectExecutableSkillDependencies(
  repoRoot: string,
): ExecutableSkillDependencyInspection {
  const tracked = readTrackedRepositoryFiles(repoRoot);
  const request: AuditExecutableSkillPackageFilesRequest = {
    repoRoot,
    tracked,
  };
  return inspectExecutableSkillPackageFiles(request);
}

export function auditExecutableSkillPackageFiles(
  request: AuditExecutableSkillPackageFilesRequest,
): readonly ExecutableSkillPackageFinding[] {
  return inspectExecutableSkillPackageFiles(request).findings;
}

function inspectExecutableSkillPackageFiles(
  request: AuditExecutableSkillPackageFilesRequest,
): ExecutableSkillDependencyInspection {
  const { repoRoot, tracked } = request;
  const collector: FindingCollector = { findings: [], bytes: 0 };
  const npmPackages = new Set<string>();
  for (const file of tracked) {
    const skillPackage = executableSkillPackageFromPath(file.path);
    if (skillPackage !== false && dangerousPath(file.path)) {
      addFinding(collector)('.cortex')(
        'tracked skill path contains unsafe characters',
      );
    }
  }
  for (const skillPackage of executableSkillPackages(tracked)) {
    if (!DECLARED_OWNER_PATH.test(`${skillPackage.packageRoot}/`)) {
      addFinding(collector)('.cortex')(
        'tracked executable-skill package has an undeclared owner',
      );
      continue;
    }
    if (!SKILL_SLUG.test(skillPackage.slug)) {
      addFinding(collector)(
        safeFindingPath(skillPackage.packageRoot)('.cortex'),
      )('executable-skill directory must use a canonical kebab-case slug');
      continue;
    }
    const packageRequest: AuditPackageRequest = {
      collector,
      npmPackages,
      repoRoot,
      skillPackage,
      tracked,
    };
    auditPackage(packageRequest);
  }
  return {
    findings: collector.findings,
    npmPackages: collector.findings.length === 0 ? [...npmPackages].sort() : [],
  };
}

type AuditPackageRequest = AuditExecutableSkillPackageFilesRequest & {
  readonly collector: FindingCollector;
  readonly npmPackages: Set<string>;
  readonly skillPackage: ExecutableSkillPackage;
};

function auditPackage(request: AuditPackageRequest): void {
  const { collector, npmPackages, repoRoot, skillPackage, tracked } = request;
  auditPackageDirectoryChain(request);
  const packageFiles = tracked.filter(
    (file) =>
      file.path === skillPackage.skillPath ||
      file.path.startsWith(`${skillPackage.scriptsRoot}/`),
  );
  for (const file of packageFiles) {
    if (file.mode !== CANONICAL_MODE) {
      addFinding(collector)(
        safeFindingPath(file.path)(skillPackage.packageRoot),
      )(`tracked executable-skill files must use mode ${CANONICAL_MODE}`);
    }
    if (file.path.startsWith(`${skillPackage.scriptsRoot}/node_modules/`)) {
      addFinding(collector)(skillPackage.scriptsRoot)(
        'node_modules content cannot be tracked in an executable-skill package',
      );
    }
    if (
      file.path.startsWith(`${skillPackage.scriptsRoot}/`) &&
      file.path.endsWith('/SKILL.md')
    ) {
      addFinding(collector)(skillPackage.scriptsRoot)(
        'scripts cannot contain a tracked skill-card mirror',
      );
    }
    if (
      (file.path.startsWith(`${skillPackage.scriptsRoot}/src/`) ||
        file.path.startsWith(`${skillPackage.scriptsRoot}/tests/`)) &&
      !file.path.endsWith('.ts')
    ) {
      addFinding(collector)(file.path)(
        'executable-skill source and test files must use the .ts extension',
      );
    }
  }
  for (const relative of [
    'SKILL.md',
    ...REQUIRED_PROJECT_FILES.map((name) => `scripts/${name}`),
  ]) {
    const expectedPath = `${skillPackage.packageRoot}/${relative}`;
    const file = packageFiles.find(
      (candidate) => candidate.path === expectedPath,
    );
    if (!file)
      addFinding(collector)(expectedPath)('required tracked file is missing');
  }
  for (const directory of ['src', 'tests']) {
    const prefix = `${skillPackage.scriptsRoot}/${directory}/`;
    if (!packageFiles.some((file) => file.path.startsWith(prefix))) {
      addFinding(collector)(prefix.slice(0, -1))(
        'required tracked directory is empty',
      );
    }
  }
  const documentPaths = [
    skillPackage.skillPath,
    `${skillPackage.scriptsRoot}/package.json`,
    `${skillPackage.scriptsRoot}/executable-skill.json`,
    `${skillPackage.scriptsRoot}/bun.lock`,
    `${skillPackage.scriptsRoot}/tsconfig.json`,
    `${skillPackage.scriptsRoot}/eslint.config.js`,
    `${skillPackage.scriptsRoot}/.prettierrc`,
  ];
  const documentsAreSafe = documentPaths.every((required) => {
    const trackedFile = packageFiles.find((file) => file.path === required);
    if (!trackedFile || trackedFile.mode !== CANONICAL_MODE) return false;
    const absolutePath = path.join(repoRoot, required);
    try {
      const metadata = lstatSync(absolutePath);
      if (metadata.isFile() && !metadata.isSymbolicLink()) return true;
    } catch {
      // The bounded finding below covers missing and unsafe working-tree nodes.
    }
    addFinding(collector)(required)(
      'executable-skill document must be a regular file',
    );
    return false;
  });
  if (documentsAreSafe) {
    const documentsRequest: AuditDocumentsRequest = {
      collector,
      npmPackages,
      repoRoot,
      skillPackage,
    };
    auditDocuments(documentsRequest);
  }
}

function auditPackageDirectoryChain(request: AuditPackageRequest): void {
  const { collector, repoRoot, skillPackage } = request;
  const segments = skillPackage.scriptsRoot.split('/');
  for (let length = 1; length <= segments.length; length += 1) {
    const relativePath = segments.slice(0, length).join('/');
    try {
      const metadata = lstatSync(path.join(repoRoot, relativePath));
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) continue;
    } catch {
      // The bounded finding below owns missing and unsafe directory nodes.
    }
    addFinding(collector)(relativePath)(
      'executable-skill path components must be real directories',
    );
  }
}

type AuditDocumentsRequest = {
  readonly collector: FindingCollector;
  readonly npmPackages: Set<string>;
  readonly repoRoot: string;
  readonly skillPackage: ExecutableSkillPackage;
};

function auditDocuments(request: AuditDocumentsRequest): void {
  const { collector, npmPackages, repoRoot, skillPackage } = request;
  const skill = readFileSync(
    path.join(repoRoot, skillPackage.skillPath),
    'utf8',
  );
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u
    .exec(skill)
    ?.at(1);
  let skillName: UntrustedYamlNode;
  try {
    skillName =
      typeof frontmatter === 'string'
        ? asUntrustedYamlNode(Bun.YAML.parse(frontmatter) as UntrustedYamlNode)
        : false;
  } catch {
    skillName = false;
  }
  if (!isRecord(skillName) || skillName.name !== skillPackage.slug) {
    addFinding(collector)(skillPackage.skillPath)(
      'SKILL.md name must equal its directory slug',
    );
  }
  const description = isRecord(skillName)
    ? property(skillName)('description')
    : false;
  if (typeof description !== 'string' || description.trim().length === 0) {
    addFinding(collector)(skillPackage.skillPath)(
      'SKILL.md description must be a nonempty string',
    );
  }
  const packagePath = `${skillPackage.scriptsRoot}/package.json`;
  const manifestPath = `${skillPackage.scriptsRoot}/executable-skill.json`;
  const lockPath = `${skillPackage.scriptsRoot}/bun.lock`;
  auditProjectConfigs(request);
  const packageRequest: ParseJsonRequest = {
    collector,
    json5: false,
    relativePath: packagePath,
    repoRoot,
  };
  const manifestRequest: ParseJsonRequest = {
    collector,
    json5: false,
    relativePath: manifestPath,
    repoRoot,
  };
  const lockRequest: ParseJsonRequest = {
    collector,
    json5: true,
    relativePath: lockPath,
    repoRoot,
  };
  const packageDocument = parseJson(packageRequest);
  const manifest = parseJson(manifestRequest);
  const lock = parseJson(lockRequest);
  if (packageDocument === false || manifest === false || lock === false) return;
  const dependencies = property(packageDocument)('devDependencies');
  if (isRecord(dependencies)) {
    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('@types/')) npmPackages.add(name);
    }
  }
  const packageAudit: AuditPackageDocumentRequest = {
    collector,
    document: packageDocument,
    packagePath,
    skillPackage,
  };
  const manifestAudit: AuditManifestRequest = {
    collector,
    document: manifest,
    manifestPath,
    skillPackage,
  };
  const lockAudit: AuditLockRequest = {
    collector,
    lock,
    lockPath,
    packageDocument,
    skillPackage,
  };
  auditPackageDocument(packageAudit);
  auditManifest(manifestAudit);
  auditLock(lockAudit);
}

function auditProjectConfigs(request: AuditDocumentsRequest): void {
  const { collector, repoRoot, skillPackage } = request;
  const scriptsRoot = skillPackage.scriptsRoot;
  const prettier = readFileSync(
    path.join(repoRoot, scriptsRoot, '.prettierrc'),
    'utf8',
  );
  const tsconfig = readFileSync(
    path.join(repoRoot, scriptsRoot, 'tsconfig.json'),
    'utf8',
  );
  const eslint = readFileSync(
    path.join(repoRoot, scriptsRoot, 'eslint.config.js'),
    'utf8',
  );
  for (const [configPath, source, expected] of [
    [`${scriptsRoot}/.prettierrc`, prettier, CONFIG_HASHES.prettier],
    [`${scriptsRoot}/tsconfig.json`, tsconfig, CONFIG_HASHES.typescript],
    [`${scriptsRoot}/eslint.config.js`, eslint, CONFIG_HASHES.eslint],
  ] as const) {
    const actual = new Bun.CryptoHasher('sha256').update(source).digest('hex');
    if (actual !== expected) {
      addFinding(collector)(configPath)(
        'executable-skill project config must match the canonical policy',
      );
    }
  }
}

type ParseJsonRequest = {
  readonly collector: FindingCollector;
  readonly json5: boolean;
  readonly relativePath: string;
  readonly repoRoot: string;
};

function parseJson(request: ParseJsonRequest): UntrustedYamlMap | false {
  const { collector, json5, relativePath, repoRoot } = request;
  try {
    const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const parsed = asUntrustedYamlNode(
      (json5
        ? Bun.JSON5.parse(source)
        : JSON.parse(source)) as UntrustedYamlNode,
    );
    if (isRecord(parsed)) return parsed;
  } catch {
    // The bounded finding below is the only untrusted parse detail exposed.
  }
  addFinding(collector)(relativePath)('document must be a valid object');
  return false;
}

type AuditPackageDocumentRequest = {
  readonly collector: FindingCollector;
  readonly document: UntrustedYamlMap;
  readonly packagePath: string;
  readonly skillPackage: ExecutableSkillPackage;
};

function auditPackageDocument(request: AuditPackageDocumentRequest): void {
  const { collector, document, packagePath, skillPackage } = request;
  const expectedName = `@nook/${skillPackage.slug}-skill`;
  const scripts = property(document)('scripts');
  const devDependencies = property(document)('devDependencies');
  const expectedKeys = [
    'devDependencies',
    'name',
    'packageManager',
    'private',
    'scripts',
    'type',
    'version',
  ];
  if (!sameKeys(document)(expectedKeys)) {
    addFinding(collector)(packagePath)(
      'package.json must use the exact executable-skill schema',
    );
  }
  if (
    document.name !== expectedName ||
    document.private !== true ||
    document.version !== '0.1.0' ||
    document.type !== 'module' ||
    document.packageManager !== 'bun@1.3.14'
  ) {
    addFinding(collector)(packagePath)(
      `package identity must be ${expectedName}`,
    );
  }
  if (!isRecord(scripts) || !sameRecord(scripts)(PACKAGE_SCRIPTS)) {
    addFinding(collector)(packagePath)(
      'scripts must equal the approved dev-only command set',
    );
  }
  if (!pinnedDependencyMap(devDependencies)) {
    addFinding(collector)(packagePath)(
      'devDependencies must be a pinned string map',
    );
  }
}

type AuditManifestRequest = {
  readonly collector: FindingCollector;
  readonly document: UntrustedYamlMap;
  readonly manifestPath: string;
  readonly skillPackage: ExecutableSkillPackage;
};

function auditManifest(request: AuditManifestRequest): void {
  const { collector, document, manifestPath, skillPackage } = request;
  if (
    !sameKeys(document)([
      'executionKind',
      'id',
      'limits',
      'policyPaths',
      'requestKind',
      'resultKind',
      'schemaVersion',
    ])
  ) {
    addFinding(collector)(manifestPath)(
      'executable-skill.json must use the exact manifest schema',
    );
  }
  const expectedPolicyPath = skillPackage.skillPath;
  const policyPaths = property(document)('policyPaths');
  const limits = property(document)('limits');
  if (
    document.schemaVersion !== 1 ||
    document.id !== skillPackage.slug ||
    (document.executionKind !== 'in-process-read-only' &&
      document.executionKind !== 'static-yaml-read-only') ||
    typeof document.requestKind !== 'string' ||
    document.requestKind.length === 0 ||
    typeof document.resultKind !== 'string' ||
    document.resultKind.length === 0 ||
    !Array.isArray(policyPaths) ||
    policyPaths.length !== 1 ||
    policyPaths.at(0) !== expectedPolicyPath ||
    !isRecord(limits) ||
    !sameKeys(limits)(['requestBytes', 'resultBytes']) ||
    !positiveInteger(property(limits)('requestBytes')) ||
    !positiveInteger(property(limits)('resultBytes'))
  ) {
    addFinding(collector)(manifestPath)(
      'manifest identity, policy path, kinds, and limits must be canonical',
    );
  }
}

type AuditLockRequest = {
  readonly collector: FindingCollector;
  readonly lock: UntrustedYamlMap;
  readonly lockPath: string;
  readonly packageDocument: UntrustedYamlMap;
  readonly skillPackage: ExecutableSkillPackage;
};

function auditLock(request: AuditLockRequest): void {
  const { collector, lock, lockPath, packageDocument, skillPackage } = request;
  const workspaces = property(lock)('workspaces');
  const rootEntry = isRecord(workspaces)
    ? Object.entries(workspaces).find(([key]) => key === '')
    : false;
  const root = rootEntry ? (rootEntry.at(1) ?? false) : false;
  const expectedName = `@nook/${skillPackage.slug}-skill`;
  const packages = property(lock)('packages');
  const rootDependencies = isRecord(root)
    ? property(root)('devDependencies')
    : false;
  const packageDependencies = property(packageDocument)('devDependencies');
  if (
    !sameKeys(lock)([
      'configVersion',
      'lockfileVersion',
      'packages',
      'workspaces',
    ]) ||
    lock.lockfileVersion !== 1 ||
    lock.configVersion !== 1 ||
    !isRecord(packages) ||
    !isRecord(root) ||
    !sameKeys(root)(['devDependencies', 'name']) ||
    root.name !== expectedName ||
    !isRecord(rootDependencies) ||
    !isRecord(packageDependencies) ||
    !sameRecord(rootDependencies)(packageDependencies)
  ) {
    addFinding(collector)(lockPath)(
      'lock workspace must exactly match package identity and devDependencies',
    );
  }
}

function sameKeys(
  record: UntrustedYamlMap,
): (expected: readonly string[]) => boolean {
  return (expected) =>
    JSON.stringify(Object.keys(record).sort()) ===
    JSON.stringify([...expected].sort());
}

function property(
  record: UntrustedYamlMap,
): (key: string) => UntrustedYamlNode {
  return (key) =>
    Object.entries(record)
      .find(([name]) => name === key)
      ?.at(1) ?? false;
}

function sameRecord(
  left: UntrustedYamlMap,
): (right: UntrustedYamlMap) => boolean {
  return (right) =>
    sameKeys(left)(Object.keys(right)) &&
    Object.entries(right).every(
      ([key, value]) =>
        Object.entries(left)
          .find(([leftKey]) => leftKey === key)
          ?.at(1) === value,
    );
}

function pinnedDependencyMap(
  value: UntrustedYamlNode,
): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        typeof entry === 'string' &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(entry),
    )
  );
}

function positiveInteger(value: UntrustedYamlNode): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function dangerousPath(candidate: string): boolean {
  for (const character of candidate) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      character === ':' ||
      character === '\\' ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x206f)
    )
      return true;
  }
  return false;
}

function safeFindingPath(candidate: string): (fallback: string) => string {
  return (fallback) =>
    dangerousPath(candidate) || candidate.length > FINDING_PATH_LIMIT
      ? fallback
      : candidate;
}

function addFinding(
  collector: FindingCollector,
): (path: string) => (issue: string) => void {
  return (candidatePath) => (issue) => {
    if (collector.findings.length >= EXECUTABLE_SKILL_FINDING_LIMIT) return;
    const findingPath = safeFindingPath(candidatePath)('.cortex');
    const boundedIssue = issue.slice(0, FINDING_ISSUE_LIMIT);
    const bytes =
      Buffer.byteLength(findingPath) + Buffer.byteLength(boundedIssue);
    if (collector.bytes + bytes > EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT)
      return;
    const finding: ExecutableSkillPackageFinding = {
      path: findingPath,
      issue: boundedIssue,
    };
    collector.findings.push(finding);
    collector.bytes += bytes;
  };
}
