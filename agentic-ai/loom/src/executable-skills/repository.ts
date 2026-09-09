import {
  ExecutableSkillFindingCollector,
  ExecutableSkillFindingPath,
} from './findings.ts';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import path from 'node:path';
import {
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';

export const EXECUTABLE_SKILL_FINDING_LIMIT = 100;
export const EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT = 32_768;
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

export type AuditExecutableSkillPackageFilesRequest = {
  readonly repoRoot: string;
  readonly tracked: readonly TrackedRepositoryFile[];
};

export type ExecutableSkillDependencyInspection = {
  readonly findings: readonly ExecutableSkillPackageFinding[];
  readonly npmPackages: readonly string[];
};

type AuditWorkspaceRequest = AuditExecutableSkillPackageFilesRequest & {
  readonly collector: ExecutableSkillFindingCollector;
  readonly skillPackages: readonly ExecutableSkillPackage[];
};

type AuditPackageRequest = AuditExecutableSkillPackageFilesRequest & {
  readonly collector: ExecutableSkillFindingCollector;
  readonly npmPackages: Set<string>;
  readonly skillPackage: ExecutableSkillPackage;
  readonly workspaceLock: UntrustedYamlMap | false;
};

type AuditDocumentsRequest = {
  readonly collector: ExecutableSkillFindingCollector;
  readonly npmPackages: Set<string>;
  readonly repoRoot: string;
  readonly skillPackage: ExecutableSkillPackage;
  readonly workspaceLock: UntrustedYamlMap | false;
};

type ParseJsonRequest = {
  readonly collector: ExecutableSkillFindingCollector;
  readonly json5: boolean;
  readonly relativePath: string;
  readonly repoRoot: string;
};

type AuditPackageDocumentRequest = {
  readonly collector: ExecutableSkillFindingCollector;
  readonly document: UntrustedYamlMap;
  readonly packagePath: string;
  readonly skillPackage: ExecutableSkillPackage;
};

type AuditManifestRequest = {
  readonly collector: ExecutableSkillFindingCollector;
  readonly document: UntrustedYamlMap;
  readonly manifestPath: string;
  readonly skillPackage: ExecutableSkillPackage;
};

type AuditLockRequest = {
  readonly collector: ExecutableSkillFindingCollector;
  readonly lock: UntrustedYamlMap;
  readonly lockPath: string;
  readonly packageDocument: UntrustedYamlMap;
  readonly skillPackage: ExecutableSkillPackage;
};

export class ExecutableSkillRepository {
  private readonly collector = new ExecutableSkillFindingCollector();
  private constructor(
    private readonly request: AuditExecutableSkillPackageFilesRequest,
  ) {}
  static readTrackedFiles(repoRoot: string): readonly TrackedRepositoryFile[] {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const output = execFileSync('git', ['ls-files', '--stage', '-z'], options);
    return output
      .split('\0')
      .filter((record) => record.length > 0)
      .map((value) => ExecutableSkillRepository.parseTrackedRecord(value));
  }

  private static parseTrackedRecord(record: string): TrackedRepositoryFile {
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

  static packageFromPath(trackedPath: string): ExecutableSkillPackage | false {
    const match = EXECUTABLE_PACKAGE_PATH.exec(trackedPath);
    const packageRoot = match?.at(1);
    const slug = match?.at(2);
    if (typeof packageRoot !== 'string' || typeof slug !== 'string')
      return false;
    return {
      packageRoot,
      scriptsRoot: `${packageRoot}/scripts`,
      skillPath: `${packageRoot}/SKILL.md`,
      slug,
    };
  }

  static packages(
    tracked: readonly TrackedRepositoryFile[],
  ): readonly ExecutableSkillPackage[] {
    const packages = new Map<string, ExecutableSkillPackage>();
    for (const file of tracked) {
      const skillPackage = ExecutableSkillRepository.packageFromPath(file.path);
      if (skillPackage !== false) {
        packages.set(skillPackage.packageRoot, skillPackage);
      }
    }
    return [...packages.keys()].sort().flatMap((packageRoot) => {
      const skillPackage = packages.get(packageRoot);
      return skillPackage ? [skillPackage] : [];
    });
  }

  static auditTracked(
    repoRoot: string,
  ): readonly ExecutableSkillPackageFinding[] {
    if (!existsSync(path.join(repoRoot, '.git'))) return [];
    const tracked = ExecutableSkillRepository.readTrackedFiles(repoRoot);
    const request: AuditExecutableSkillPackageFilesRequest = {
      repoRoot,
      tracked,
    };
    return ExecutableSkillRepository.auditFiles(request);
  }

  static inspectDependencies(
    repoRoot: string,
  ): ExecutableSkillDependencyInspection {
    const tracked = ExecutableSkillRepository.readTrackedFiles(repoRoot);
    const request: AuditExecutableSkillPackageFilesRequest = {
      repoRoot,
      tracked,
    };
    return new ExecutableSkillRepository(request).inspect();
  }

  static auditFiles(
    request: AuditExecutableSkillPackageFilesRequest,
  ): readonly ExecutableSkillPackageFinding[] {
    return new ExecutableSkillRepository(request).inspect().findings;
  }

  private inspect(): ExecutableSkillDependencyInspection {
    const request = this.request;
    const { repoRoot, tracked } = request;
    const collector = this.collector;
    const npmPackages = new Set<string>();
    const skillPackages = ExecutableSkillRepository.packages(tracked);
    for (const file of tracked) {
      const skillPackage = ExecutableSkillRepository.packageFromPath(file.path);
      if (
        file.path.startsWith(`${EXECUTABLE_SKILL_WORKSPACE_ROOT}/node_modules/`)
      ) {
        collector.add({
          path: EXECUTABLE_SKILL_WORKSPACE_ROOT,
          issue:
            'node_modules content cannot be tracked in the executable-skill workspace',
        });
      }
      if (
        skillPackage !== false &&
        ExecutableSkillFindingPath.dangerousPath(file.path)
      ) {
        collector.add({
          path: '.cortex',
          issue: 'tracked skill path contains unsafe characters',
        });
      }
    }
    const workspaceLock =
      skillPackages.length > 0
        ? this.auditExecutableSkillWorkspace({
            collector,
            repoRoot,
            skillPackages,
            tracked,
          })
        : false;
    for (const skillPackage of skillPackages) {
      if (!DECLARED_OWNER_PATH.test(`${skillPackage.packageRoot}/`)) {
        collector.add({
          path: '.cortex',
          issue: 'tracked executable-skill package has an undeclared owner',
        });
        continue;
      }
      if (!SKILL_SLUG.test(skillPackage.slug)) {
        collector.add({
          path: ExecutableSkillFindingPath.safe({
            candidate: skillPackage.packageRoot,
            fallback: '.cortex',
          }),
          issue:
            'executable-skill directory must use a canonical kebab-case slug',
        });
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
      this.auditPackage(packageRequest);
    }
    return {
      findings: collector.findings,
      npmPackages:
        collector.findings.length === 0 ? [...npmPackages].sort() : [],
    };
  }

  private auditExecutableSkillWorkspace(
    request: AuditWorkspaceRequest,
  ): UntrustedYamlMap | false {
    const { collector, repoRoot, skillPackages, tracked } = request;
    const requiredPaths = EXECUTABLE_SKILL_WORKSPACE_FILES.map(
      (name) => `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/${name}`,
    );
    const documentsAreSafe = requiredPaths.every((required) => {
      const trackedFile = tracked.find((file) => file.path === required);
      if (!trackedFile) {
        collector.add({
          path: required,
          issue: 'required executable-skill workspace file is missing',
        });
        return false;
      }
      if (trackedFile.mode !== CANONICAL_MODE) {
        collector.add({
          path: required,
          issue: `tracked executable-skill workspace files must use mode ${CANONICAL_MODE}`,
        });
        return false;
      }
      try {
        const metadata = lstatSync(path.join(repoRoot, required));
        if (metadata.isFile() && !metadata.isSymbolicLink()) return true;
      } catch {
        // The bounded finding below owns unsafe workspace documents.
      }
      collector.add({
        path: required,
        issue: 'executable-skill workspace document must be a regular file',
      });
      return false;
    });
    if (!documentsAreSafe) return false;
    const packagePath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/package.json`;
    const lockPath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bun.lock`;
    const packageDocument = this.parseJson({
      collector,
      json5: false,
      relativePath: packagePath,
      repoRoot,
    });
    const lock = this.parseJson({
      collector,
      json5: true,
      relativePath: lockPath,
      repoRoot,
    });
    const bunfigPath = `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bunfig.toml`;
    const bunfig = readFileSync(path.join(repoRoot, bunfigPath), 'utf8');
    if (bunfig !== EXECUTABLE_SKILL_BUNFIG) {
      collector.add({
        path: bunfigPath,
        issue:
          'executable-skill workspace must use the canonical hoisted linker',
      });
    }
    if (packageDocument !== false) {
      const workspaces = this.property(packageDocument)('workspaces');
      if (
        !this.sameKeys(packageDocument)([
          'name',
          'packageManager',
          'private',
          'workspaces',
        ]) ||
        packageDocument.name !== EXECUTABLE_SKILL_WORKSPACE_NAME ||
        packageDocument.private !== true ||
        packageDocument.packageManager !== 'bun@1.3.14' ||
        !Array.isArray(workspaces) ||
        JSON.stringify(workspaces) !==
          JSON.stringify(EXECUTABLE_SKILL_WORKSPACES)
      ) {
        collector.add({
          path: packagePath,
          issue:
            'executable-skill workspace package must match the canonical policy',
        });
      }
    }
    if (lock !== false) {
      const workspaces = this.property(lock)('workspaces');
      const expectedWorkspaceKeys = [
        '',
        ...skillPackages.map((skillPackage) =>
          skillPackage.scriptsRoot.slice(
            `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/`.length,
          ),
        ),
      ];
      const rootWorkspace = UntrustedYamlBoundary.isRecord(workspaces)
        ? this.property(workspaces)('')
        : false;
      if (
        !this.sameKeys(lock)([
          'configVersion',
          'lockfileVersion',
          'packages',
          'workspaces',
        ]) ||
        lock.lockfileVersion !== 1 ||
        lock.configVersion !== 1 ||
        !UntrustedYamlBoundary.isRecord(this.property(lock)('packages')) ||
        !UntrustedYamlBoundary.isRecord(workspaces) ||
        !this.sameKeys(workspaces)(expectedWorkspaceKeys) ||
        !UntrustedYamlBoundary.isRecord(rootWorkspace) ||
        !this.sameKeys(rootWorkspace)(['name']) ||
        rootWorkspace.name !== EXECUTABLE_SKILL_WORKSPACE_NAME
      ) {
        collector.add({
          path: lockPath,
          issue:
            'workspace lock must exactly cover the executable-skill packages',
        });
      }
    }
    return lock;
  }

  private auditPackage(request: AuditPackageRequest): void {
    const {
      collector,
      npmPackages,
      repoRoot,
      skillPackage,
      tracked,
      workspaceLock,
    } = request;
    this.auditPackageDirectoryChain(request);
    const packageFiles = tracked.filter(
      (file) =>
        file.path === skillPackage.skillPath ||
        file.path.startsWith(`${skillPackage.scriptsRoot}/`),
    );
    for (const file of packageFiles) {
      if (file.mode !== CANONICAL_MODE) {
        collector.add({
          path: ExecutableSkillFindingPath.safe({
            candidate: file.path,
            fallback: skillPackage.packageRoot,
          }),
          issue: `tracked executable-skill files must use mode ${CANONICAL_MODE}`,
        });
      }
      if (file.path.startsWith(`${skillPackage.scriptsRoot}/node_modules/`)) {
        collector.add({
          path: skillPackage.scriptsRoot,
          issue:
            'node_modules content cannot be tracked in an executable-skill package',
        });
      }
      if (file.path === `${skillPackage.scriptsRoot}/bun.lock`) {
        collector.add({
          path: file.path,
          issue: 'executable-skill packages must use the shared workspace lock',
        });
      }
      if (
        file.path.startsWith(`${skillPackage.scriptsRoot}/`) &&
        file.path.endsWith('/SKILL.md')
      ) {
        collector.add({
          path: skillPackage.scriptsRoot,
          issue: 'scripts cannot contain a tracked skill-card mirror',
        });
      }
      if (
        (file.path.startsWith(`${skillPackage.scriptsRoot}/src/`) ||
          file.path.startsWith(`${skillPackage.scriptsRoot}/tests/`)) &&
        !file.path.endsWith('.ts')
      ) {
        collector.add({
          path: file.path,
          issue:
            'executable-skill source and test files must use the .ts extension',
        });
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
        collector.add({
          path: expectedPath,
          issue: 'required tracked file is missing',
        });
    }
    for (const directory of ['src', 'tests']) {
      const prefix = `${skillPackage.scriptsRoot}/${directory}/`;
      if (!packageFiles.some((file) => file.path.startsWith(prefix))) {
        collector.add({
          path: prefix.slice(0, -1),
          issue: 'required tracked directory is empty',
        });
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
      collector.add({
        path: required,
        issue: 'executable-skill document must be a regular file',
      });
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
      this.auditDocuments(documentsRequest);
    }
  }

  private auditPackageDirectoryChain(request: AuditPackageRequest): void {
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
      collector.add({
        path: relativePath,
        issue: 'executable-skill path components must be real directories',
      });
    }
  }

  private auditDocuments(request: AuditDocumentsRequest): void {
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
          ? UntrustedYamlBoundary.fromHost(
              Bun.YAML.parse(frontmatter) as UntrustedYamlNode,
            )
          : false;
    } catch {
      skillName = false;
    }
    if (
      !UntrustedYamlBoundary.isRecord(skillName) ||
      skillName.name !== skillPackage.slug
    ) {
      collector.add({
        path: skillPackage.skillPath,
        issue: 'SKILL.md name must equal its directory slug',
      });
    }
    const description = UntrustedYamlBoundary.isRecord(skillName)
      ? this.property(skillName)('description')
      : false;
    if (typeof description !== 'string' || description.trim().length === 0) {
      collector.add({
        path: skillPackage.skillPath,
        issue: 'SKILL.md description must be a nonempty string',
      });
    }
    const packagePath = `${skillPackage.scriptsRoot}/package.json`;
    const manifestPath = `${skillPackage.scriptsRoot}/executable-skill.json`;
    this.auditProjectConfigs(request);
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
    const packageDocument = this.parseJson(packageRequest);
    const manifest = this.parseJson(manifestRequest);
    if (packageDocument === false || manifest === false) return;
    const dependencies = this.property(packageDocument)('devDependencies');
    if (UntrustedYamlBoundary.isRecord(dependencies)) {
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
    this.auditPackageDocument(packageAudit);
    this.auditManifest(manifestAudit);
    if (workspaceLock !== false) {
      const lockAudit: AuditLockRequest = {
        collector,
        lock: workspaceLock,
        lockPath: `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/bun.lock`,
        packageDocument,
        skillPackage,
      };
      this.auditLock(lockAudit);
    }
  }

  private auditProjectConfigs(request: AuditDocumentsRequest): void {
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
      const actual = new Bun.CryptoHasher('sha256')
        .update(source)
        .digest('hex');
      if (actual !== expected) {
        collector.add({
          path: configPath,
          issue:
            'executable-skill project config must match the canonical policy',
        });
      }
    }
  }

  private parseJson(request: ParseJsonRequest): UntrustedYamlMap | false {
    const { collector, json5, relativePath, repoRoot } = request;
    try {
      const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
      const parsed = UntrustedYamlBoundary.fromHost(
        (json5
          ? Bun.JSON5.parse(source)
          : JSON.parse(source)) as UntrustedYamlNode,
      );
      if (UntrustedYamlBoundary.isRecord(parsed)) return parsed;
    } catch {
      // The bounded finding below is the only untrusted parse detail exposed.
    }
    collector.add({
      path: relativePath,
      issue: 'document must be a valid object',
    });
    return false;
  }

  private auditPackageDocument(request: AuditPackageDocumentRequest): void {
    const { collector, document, packagePath, skillPackage } = request;
    const expectedName = `@nook/${skillPackage.slug}-skill`;
    const scripts = this.property(document)('scripts');
    const devDependencies = this.property(document)('devDependencies');
    const expectedKeys = [
      'devDependencies',
      'name',
      'packageManager',
      'private',
      'scripts',
      'type',
      'version',
    ];
    if (!this.sameKeys(document)(expectedKeys)) {
      collector.add({
        path: packagePath,
        issue: 'package.json must use the exact executable-skill schema',
      });
    }
    if (
      document.name !== expectedName ||
      document.private !== true ||
      document.version !== '0.1.0' ||
      document.type !== 'module' ||
      document.packageManager !== 'bun@1.3.14'
    ) {
      collector.add({
        path: packagePath,
        issue: `package identity must be ${expectedName}`,
      });
    }
    if (
      !UntrustedYamlBoundary.isRecord(scripts) ||
      !this.sameRecord(scripts)(PACKAGE_SCRIPTS)
    ) {
      collector.add({
        path: packagePath,
        issue: 'scripts must equal the approved dev-only command set',
      });
    }
    if (!this.pinnedDependencyMap(devDependencies)) {
      collector.add({
        path: packagePath,
        issue: 'devDependencies must be a pinned string map',
      });
    }
  }

  private auditManifest(request: AuditManifestRequest): void {
    const { collector, document, manifestPath, skillPackage } = request;
    if (
      !this.sameKeys(document)([
        'executionKind',
        'id',
        'limits',
        'policyPaths',
        'requestKind',
        'resultKind',
        'schemaVersion',
      ])
    ) {
      collector.add({
        path: manifestPath,
        issue: 'executable-skill.json must use the exact manifest schema',
      });
    }
    const expectedPolicyPath = skillPackage.skillPath;
    const policyPaths = this.property(document)('policyPaths');
    const limits = this.property(document)('limits');
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
      !UntrustedYamlBoundary.isRecord(limits) ||
      !this.sameKeys(limits)(['requestBytes', 'resultBytes']) ||
      !this.positiveInteger(this.property(limits)('requestBytes')) ||
      !this.positiveInteger(this.property(limits)('resultBytes'))
    ) {
      collector.add({
        path: manifestPath,
        issue:
          'manifest identity, policy path, kinds, and limits must be canonical',
      });
    }
  }

  private auditLock(request: AuditLockRequest): void {
    const { collector, lock, lockPath, packageDocument, skillPackage } =
      request;
    const workspaces = this.property(lock)('workspaces');
    const workspacePath = skillPackage.scriptsRoot.slice(
      `${EXECUTABLE_SKILL_WORKSPACE_ROOT}/`.length,
    );
    const workspace = UntrustedYamlBoundary.isRecord(workspaces)
      ? this.property(workspaces)(workspacePath)
      : false;
    const expectedName = `@nook/${skillPackage.slug}-skill`;
    const packages = this.property(lock)('packages');
    const workspaceDependencies = UntrustedYamlBoundary.isRecord(workspace)
      ? this.property(workspace)('devDependencies')
      : false;
    const packageDependencies =
      this.property(packageDocument)('devDependencies');
    if (
      !this.sameKeys(lock)([
        'configVersion',
        'lockfileVersion',
        'packages',
        'workspaces',
      ]) ||
      lock.lockfileVersion !== 1 ||
      lock.configVersion !== 1 ||
      !UntrustedYamlBoundary.isRecord(packages) ||
      !UntrustedYamlBoundary.isRecord(workspace) ||
      !this.sameKeys(workspace)(['devDependencies', 'name', 'version']) ||
      workspace.name !== expectedName ||
      workspace.version !== '0.1.0' ||
      !UntrustedYamlBoundary.isRecord(workspaceDependencies) ||
      !UntrustedYamlBoundary.isRecord(packageDependencies) ||
      !this.sameRecord(workspaceDependencies)(packageDependencies)
    ) {
      collector.add({
        path: lockPath,
        issue:
          'workspace lock entry must exactly match package identity and devDependencies',
      });
    }
  }

  private sameKeys(
    record: UntrustedYamlMap,
  ): (expected: readonly string[]) => boolean {
    return (expected) =>
      JSON.stringify(Object.keys(record).sort()) ===
      JSON.stringify([...expected].sort());
  }

  private property(
    record: UntrustedYamlMap,
  ): (key: string) => UntrustedYamlNode {
    return (key) => {
      const [value = false] = [
        Object.entries(record)
          .find(([name]) => name === key)
          ?.at(1),
      ];
      return value;
    };
  }

  private sameRecord(
    left: UntrustedYamlMap,
  ): (right: UntrustedYamlMap) => boolean {
    return (right) =>
      this.sameKeys(left)(Object.keys(right)) &&
      Object.entries(right).every(
        ([key, value]) =>
          Object.entries(left)
            .find(([leftKey]) => leftKey === key)
            ?.at(1) === value,
      );
  }

  private pinnedDependencyMap(
    value: UntrustedYamlNode,
  ): value is Record<string, string> {
    return (
      UntrustedYamlBoundary.isRecord(value) &&
      Object.values(value).every(
        (entry) =>
          typeof entry === 'string' &&
          /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(entry),
      )
    );
  }

  private positiveInteger(value: UntrustedYamlNode): boolean {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    );
  }
}
