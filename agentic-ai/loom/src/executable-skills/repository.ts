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
export const EXECUTABLE_SKILL_WORKSPACE_ROOT = '.cortex';
const EXECUTABLE_SKILL_WORKSPACE_FILES = [
  '.gitignore',
  'bun.lock',
  'bunfig.toml',
  'package.json',
] as const;
const EXECUTABLE_SKILL_WORKSPACES = [
  'gizmo/dynamic-skills/*/scripts',
  'shared/dynamic-skills/*/scripts',
  'teams/*/dynamic-skills/*/scripts',
] as const;
const EXECUTABLE_SKILL_WORKSPACE_NAME = '@nook/executable-skills-workspace';
const EXECUTABLE_SKILL_BUNFIG = '[install]\nlinker = "hoisted"\n';
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
  const skillPackages = executableSkillPackages(tracked);
  for (const file of tracked) {
    const skillPackage = executableSkillPackageFromPath(file.path);
    if (
      file.path.startsWith(`${EXECUTABLE_SKILL_WORKSPACE_ROOT}/node_modules/`)
    ) {
      addFinding(collector)(EXECUTABLE_SKILL_WORKSPACE_ROOT)(
        'node_modules content cannot be tracked in the executable-skill workspace',
      );
    }
    if (skillPackage !== false && dangerousPath(file.path)) {
      addFinding(collector)('.cortex')(
        'tracked skill path contains unsafe characters',
      );
    }
  }
  const workspaceLock =
    skillPackages.length > 0
      ? auditExecutableSkillWorkspace({
          collector,
          repoRoot,
          skillPackages,
          tracked,
        })
      : false;
  for (const skillPackage of skillPackages) {
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
      workspaceLock,
    };
    auditPackage(packageRequest);
  }
  return {
    findings: collector.findings,
    npmPackages: collector.findings.length === 0 ? [...npmPackages].sort() : [],
  };
}

type AuditWorkspaceRequest = AuditExecutableSkillPackageFilesRequest & {
  readonly collector: FindingCollector;
  readonly skillPackages: readonly ExecutableSkillPackage[];
};

function auditExecutableSkillWorkspace(
  request: AuditWorkspaceRequest,
): UntrustedYamlMap | false {
  const { collector, repoRoot, skillPackages, tracked } = request;
  const requiredPaths = EXECUTABLE_SKILL_WORKSPACE_FILES.map(
    (name) => `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/${name}`,
  );
  const documentsAreSafe = requiredPaths.every((required) => {
    const trackedFile = tracked.find((file) => file.path === required);
    if (!trackedFile) {
      addFinding(collector)(required)(
        'required executable-skill workspace file is missing',
      );
      return false;
    }
    if (trackedFile.mode !== CANONICAL_MODE) {
      addFinding(collector)(required)(
        `tracked executable-skill workspace files must use mode ${CANONICAL_MODE}`,
      );
      return false;
    }
    try {
      const metadata = lstatSync(path.join(repoRoot, required));
      if (metadata.isFile() && !metadata.isSymbolicLink()) return true;
    } catch {
      // The bounded finding below owns unsafe workspace documents.
    }
    addFinding(collector)(required)(
      'executable-skill workspace document must be a regular file',
    );
    return false;
  });
  if (!documentsAreSafe) return false;
  const packagePath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/package.json`;
  const lockPath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bun.lock`;
  const packageDocument = parseJson({
    collector,
    json5: false,
    relativePath: packagePath,
    repoRoot,
  });
  const lock = parseJson({
    collector,
    json5: true,
    relativePath: lockPath,
    repoRoot,
  });
  const bunfigPath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bunfig.toml`;
  const bunfig = readFileSync(path.join(repoRoot, bunfigPath), 'utf8');
  if (bunfig !== EXECUTABLE_SKILL_BUNFIG) {
    addFinding(collector)(bunfigPath)(
      'executable-skill workspace must use the canonical hoisted linker',
    );
  }
  if (packageDocument !== false) {
    const workspaces = property(packageDocument)('workspaces');
    if (
      !sameKeys(packageDocument)([
        'name',
        'packageManager',
        'private',
        'workspaces',
      ]) ||
      packageDocument.name !== EXECUTABLE_SKILL_WORKSPACE_NAME ||
      packageDocument.private !== true ||
      packageDocument.packageManager !== 'bun@1.3.14' ||
      !Array.isArray(workspaces) ||
      JSON.stringify(workspaces) !== JSON.stringify(EXECUTABLE_SKILL_WORKSPACES)
    ) {
      addFinding(collector)(packagePath)(
        'executable-skill workspace package must match the canonical policy',
      );
    }
  }
  if (lock !== false) {
    const workspaces = property(lock)('workspaces');
    const expectedWorkspaceKeys = [
      '',
      ...skillPackages.map((skillPackage) =>
        skillPackage.scriptsRoot.slice(
          `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/`.length,
        ),
      ),
    ];
    const rootWorkspace = isRecord(workspaces)
      ? property(workspaces)('')
      : false;
    if (
      !sameKeys(lock)([
        'configVersion',
        'lockfileVersion',
        'packages',
        'workspaces',
      ]) ||
      lock.lockfileVersion !== 1 ||
      lock.configVersion !== 1 ||
      !isRecord(property(lock)('packages')) ||
      !isRecord(workspaces) ||
      !sameKeys(workspaces)(expectedWorkspaceKeys) ||
      !isRecord(rootWorkspace) ||
      !sameKeys(rootWorkspace)(['name']) ||
      rootWorkspace.name !== EXECUTABLE_SKILL_WORKSPACE_NAME
    ) {
      addFinding(collector)(lockPath)(
        'workspace lock must exactly cover the executable-skill packages',
      );
    }
  }
  return lock;
}

type AuditPackageRequest = AuditExecutableSkillPackageFilesRequest & {
  readonly collector: FindingCollector;
  readonly npmPackages: Set<string>;
  readonly skillPackage: ExecutableSkillPackage;
  readonly workspaceLock: UntrustedYamlMap | false;
};

function auditPackage(request: AuditPackageRequest): void {
  const {
    collector,
    npmPackages,
    repoRoot,
    skillPackage,
    tracked,
    workspaceLock,
  } = request;
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
    if (file.path === `${skillPackage.scriptsRoot}/bun.lock`) {
      addFinding(collector)(file.path)(
        'executable-skill packages must use the shared workspace lock',
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
      workspaceLock,
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
  readonly workspaceLock: UntrustedYamlMap | false;
};

function auditDocuments(request: AuditDocumentsRequest): void {
  const { collector, npmPackages, repoRoot, skillPackage, workspaceLock } =
    request;
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
  const packageDocument = parseJson(packageRequest);
  const manifest = parseJson(manifestRequest);
  if (packageDocument === false || manifest === false) return;
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
  auditPackageDocument(packageAudit);
  auditManifest(manifestAudit);
  if (workspaceLock !== false) {
    const lockAudit: AuditLockRequest = {
      collector,
      lock: workspaceLock,
      lockPath: `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bun.lock`,
      packageDocument,
      skillPackage,
    };
    auditLock(lockAudit);
  }
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
  const workspacePath = skillPackage.scriptsRoot.slice(
    `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/`.length,
  );
  const workspace = isRecord(workspaces)
    ? property(workspaces)(workspacePath)
    : false;
  const expectedName = `@nook/${skillPackage.slug}-skill`;
  const packages = property(lock)('packages');
  const workspaceDependencies = isRecord(workspace)
    ? property(workspace)('devDependencies')
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
    !isRecord(workspace) ||
    !sameKeys(workspace)(['devDependencies', 'name', 'version']) ||
    workspace.name !== expectedName ||
    workspace.version !== '0.1.0' ||
    !isRecord(workspaceDependencies) ||
    !isRecord(packageDependencies) ||
    !sameRecord(workspaceDependencies)(packageDependencies)
  ) {
    addFinding(collector)(lockPath)(
      'workspace lock entry must exactly match package identity and devDependencies',
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
