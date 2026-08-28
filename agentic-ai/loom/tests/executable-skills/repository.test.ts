import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  auditExecutableSkillPackageFiles,
  EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT,
  EXECUTABLE_SKILL_FINDING_LIMIT,
  readTrackedRepositoryFiles,
  type TrackedRepositoryFile,
} from '../../src/executable-skills/repository.ts';
import type { UntrustedYamlMap } from '../../src/lib/guards.ts';

const ROOT = '.cortex/teams/ai/dynamic-skills/example';
const SCRIPTS = `${ROOT}/scripts`;
const REMOVE_OPTIONS = { recursive: true, force: true } as const;
const DIRECTORY_OPTIONS = { recursive: true } as const;

const PACKAGE_DOCUMENT = {
  name: '@nook/example-skill',
  private: true,
  version: '0.1.0',
  type: 'module',
  packageManager: 'bun@1.3.14',
  scripts: {
    check: 'tsc --noEmit',
    lint: 'eslint .',
    format:
      'prettier --write "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
    'format:check':
      'prettier --check "src/**/*.ts" "tests/**/*.ts" executable-skill.json "*.{json,md}" eslint.config.js .prettierrc',
    test: 'bun test tests',
    verify:
      'bun run format:check && bun run lint && bun run check && bun test tests',
  },
  devDependencies: { typescript: '6.0.3' },
} as const;

const MANIFEST = {
  schemaVersion: 1,
  id: 'example',
  executionKind: 'in-process-read-only',
  requestKind: 'example-request-v1',
  resultKind: 'example-result-v1',
  policyPaths: [`${ROOT}/SKILL.md`],
  limits: { requestBytes: 1024, resultBytes: 1024 },
} as const;

function trackedFiles(): TrackedRepositoryFile[] {
  return [
    `${ROOT}/SKILL.md`,
    `${SCRIPTS}/.gitignore`,
    `${SCRIPTS}/.prettierrc`,
    `${SCRIPTS}/bun.lock`,
    `${SCRIPTS}/eslint.config.js`,
    `${SCRIPTS}/executable-skill.json`,
    `${SCRIPTS}/package.json`,
    `${SCRIPTS}/tsconfig.json`,
    `${SCRIPTS}/src/index.ts`,
    `${SCRIPTS}/tests/index.test.ts`,
  ].map((path) => ({ mode: '100644', path }));
}

type FixtureOverrides = {
  readonly lock?: UntrustedYamlMap;
  readonly manifest?: UntrustedYamlMap;
  readonly packageDocument?: UntrustedYamlMap;
  readonly skill?: string;
};

async function packageFixture(overrides?: FixtureOverrides): Promise<string> {
  const selected = overrides ?? {};
  const repoRoot = await mkdtemp(join(tmpdir(), 'executable-skill-package-'));
  await mkdir(join(repoRoot, SCRIPTS, 'src'), DIRECTORY_OPTIONS);
  await mkdir(join(repoRoot, SCRIPTS, 'tests'), DIRECTORY_OPTIONS);
  const packageDocument = selected.packageDocument ?? PACKAGE_DOCUMENT;
  const lock = selected.lock ?? {
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      '': {
        name: '@nook/example-skill',
        devDependencies: packageDocument.devDependencies,
      },
    },
    packages: {},
  };
  await Promise.all([
    writeFile(
      join(repoRoot, ROOT, 'SKILL.md'),
      selected.skill ?? '---\nname: example\ndescription: Test skill.\n---\n',
    ),
    writeFile(
      join(repoRoot, SCRIPTS, 'package.json'),
      JSON.stringify(packageDocument),
    ),
    writeFile(
      join(repoRoot, SCRIPTS, 'executable-skill.json'),
      JSON.stringify(selected.manifest ?? MANIFEST),
    ),
    writeFile(join(repoRoot, SCRIPTS, 'bun.lock'), JSON.stringify(lock)),
  ]);
  return repoRoot;
}

function audit(repoRoot: string) {
  return (tracked: readonly TrackedRepositoryFile[]) => {
    const request = { repoRoot, tracked };
    return auditExecutableSkillPackageFiles(request);
  };
}

test('accepts the exact canonical executable-skill package schema', async () => {
  const repoRoot = await packageFixture();
  try {
    expect(audit(repoRoot)(trackedFiles())).toEqual([]);
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('rejects unsafe tracked modes and tracked node_modules', async () => {
  const repoRoot = await packageFixture();
  try {
    const files = trackedFiles();
    const nodeModulesFile: TrackedRepositoryFile = {
      mode: '100644',
      path: `${SCRIPTS}/node_modules/hidden.js`,
    };
    files.push(nodeModulesFile);
    const mirror: TrackedRepositoryFile = {
      mode: '100644',
      path: `${SCRIPTS}/SKILL.md`,
    };
    files.push(mirror);
    for (const [index, mode] of ['100755', '120000', '160000'].entries()) {
      const candidate = files.at(index);
      if (candidate) files[index] = { ...candidate, mode };
    }
    const findings = audit(repoRoot)(files);
    expect(
      findings.filter((finding) => finding.issue.includes('mode 100644')),
    ).toHaveLength(3);
    expect(
      findings.some((finding) => finding.issue.includes('node_modules')),
    ).toBe(true);
    expect(findings.some((finding) => finding.issue.includes('mirror'))).toBe(
      true,
    );
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('rejects every non-TypeScript executable source extension', async () => {
  const repoRoot = await packageFixture();
  try {
    const unsupported = ['runtime.js', 'component.tsx', 'launcher'];
    const files = [
      ...trackedFiles(),
      ...unsupported.map((name) => {
        const file: TrackedRepositoryFile = {
          mode: '100644',
          path: `${SCRIPTS}/src/${name}`,
        };
        return file;
      }),
    ];
    const findings = audit(repoRoot)(files).filter((finding) =>
      finding.issue.includes('.ts extension'),
    );
    expect(findings.map((finding) => finding.path)).toEqual(
      unsupported.map((name) => `${SCRIPTS}/src/${name}`),
    );
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('returns central findings for invalid skill descriptions', async () => {
  for (const skill of [
    '---\nname: example\n---\n',
    '---\nname: example\ndescription: null\n---\n',
    '---\nname: example\ndescription: 42\n---\n',
    '---\nname: example\ndescription: ""\n---\n',
  ]) {
    const overrides: FixtureOverrides = { skill };
    const repoRoot = await packageFixture(overrides);
    try {
      const findings = audit(repoRoot)(trackedFiles());
      const expectedFinding = {
        path: `${ROOT}/SKILL.md`,
        issue: 'SKILL.md description must be a nonempty string',
      };
      expect(findings).toContainEqual(expectedFinding);
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  }
});

test('never follows noncanonical tracked document symlinks', async () => {
  const repoRoot = await packageFixture();
  try {
    const packagePath = join(repoRoot, SCRIPTS, 'package.json');
    await rm(packagePath);
    await symlink('/dev/null', packagePath);
    const noncanonicalFiles = trackedFiles().map((file) =>
      file.path === `${SCRIPTS}/package.json`
        ? { ...file, mode: '120000' }
        : file,
    );
    const noncanonicalFindings = audit(repoRoot)(noncanonicalFiles);
    expect(
      noncanonicalFindings.some((finding) =>
        finding.issue.includes('mode 100644'),
      ),
    ).toBe(true);
    expect(
      noncanonicalFindings.some((finding) =>
        finding.issue.includes('valid object'),
      ),
    ).toBe(false);
    const unsafeWorkingTreeFindings = audit(repoRoot)(trackedFiles());
    expect(
      unsafeWorkingTreeFindings.some((finding) =>
        finding.issue.includes('regular file'),
      ),
    ).toBe(true);
    expect(
      unsafeWorkingTreeFindings.some((finding) =>
        finding.issue.includes('valid object'),
      ),
    ).toBe(false);
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('rejects executable packages under undeclared team owners', async () => {
  const repoRoot = await packageFixture();
  try {
    const typo: TrackedRepositoryFile = {
      mode: '100644',
      path: '.cortex/teams/a1/dynamic-skills/example/scripts/package.json',
    };
    const findings = audit(repoRoot)([...trackedFiles(), typo]);
    const expectedFinding = {
      path: '.cortex',
      issue: 'tracked executable-skill package has an undeclared owner',
    };
    expect(findings).toContainEqual(expectedFinding);
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('parses NUL-separated tracked paths without newline ambiguity', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'tracked-skill-paths-'));
  try {
    const initOptions = { cmd: ['git', 'init', '-q'], cwd: repoRoot };
    Bun.spawnSync(initOptions);
    const trackedPath = '.cortex/line\nbreak.md';
    await mkdir(join(repoRoot, '.cortex'), DIRECTORY_OPTIONS);
    await writeFile(join(repoRoot, trackedPath), 'tracked');
    const addOptions = {
      cmd: ['git', 'add', '--', trackedPath],
      cwd: repoRoot,
    };
    const add = Bun.spawnSync(addOptions);
    expect(add.exitCode).toBe(0);
    const expectedFile: TrackedRepositoryFile = {
      mode: '100644',
      path: trackedPath,
    };
    expect(readTrackedRepositoryFiles(repoRoot)).toContainEqual(expectedFile);
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('rejects identity, policy, runtime dependency, lifecycle, and lock drift', async () => {
  const cases: readonly FixtureOverrides[] = [
    { skill: '---\nname: wrong\ndescription: Test.\n---\n' },
    { packageDocument: { ...PACKAGE_DOCUMENT, name: '@nook/wrong-skill' } },
    {
      packageDocument: {
        ...PACKAGE_DOCUMENT,
        dependencies: { danger: '1.0.0' },
      },
    },
    {
      packageDocument: {
        ...PACKAGE_DOCUMENT,
        bin: { danger: './danger.js' },
      },
    },
    {
      packageDocument: {
        ...PACKAGE_DOCUMENT,
        devDependencies: { danger: 'file:../danger' },
      },
    },
    {
      packageDocument: {
        ...PACKAGE_DOCUMENT,
        scripts: { ...PACKAGE_DOCUMENT.scripts, postinstall: 'danger' },
      },
    },
    { manifest: { ...MANIFEST, id: 'wrong' } },
    { manifest: { ...MANIFEST, policyPaths: ['elsewhere/SKILL.md'] } },
    {
      lock: {
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { '': { name: '@nook/wrong-skill', devDependencies: {} } },
        packages: {},
      },
    },
  ];
  for (const overrides of cases) {
    const repoRoot = await packageFixture(overrides);
    try {
      expect(audit(repoRoot)(trackedFiles()).length).toBeGreaterThan(0);
    } finally {
      await rm(repoRoot, REMOVE_OPTIONS);
    }
  }
});

test('parsed JSON keys cannot hide runtime dependency fields', async () => {
  const repoRoot = await packageFixture();
  try {
    await writeFile(
      join(repoRoot, SCRIPTS, 'package.json'),
      JSON.stringify(PACKAGE_DOCUMENT).replace(
        '"devDependencies"',
        '"de\\u0076Dependencies"',
      ),
    );
    expect(audit(repoRoot)(trackedFiles())).toEqual([]);
    const escapedRuntime = JSON.stringify(PACKAGE_DOCUMENT).replace(
      '"devDependencies"',
      '"de\\u0070endencies"',
    );
    await writeFile(join(repoRoot, SCRIPTS, 'package.json'), escapedRuntime);
    const findings = audit(repoRoot)(trackedFiles());
    expect(
      findings.some((finding) =>
        finding.issue.includes('exact executable-skill schema'),
      ),
    ).toBe(true);
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});

test('bounds and sanitizes adversarial package diagnostics', async () => {
  const repoRoot = await packageFixture();
  try {
    const dangerous = [
      ':colon',
      '\\backslash',
      '\nnewline',
      '\u0007control',
      '\u2028line',
      '\u2029paragraph',
      '\u202ebidi',
      '\u206aisolate',
      '\u206fcontrol',
    ];
    const files = trackedFiles();
    const oversizedPath: TrackedRepositoryFile = {
      mode: '100755',
      path: `${SCRIPTS}/${'a'.repeat(600)}.ts`,
    };
    files.push(oversizedPath);
    for (let index = 0; index < 200; index += 1) {
      const suffix = dangerous.at(index % dangerous.length) ?? ':colon';
      const dangerousFile: TrackedRepositoryFile = {
        mode: '100755',
        path: `${SCRIPTS}/${index}${suffix}`,
      };
      files.push(dangerousFile);
    }
    const findings = audit(repoRoot)(files);
    expect(findings.length).toBe(EXECUTABLE_SKILL_FINDING_LIMIT);
    let diagnosticBytes = 0;
    for (const finding of findings) {
      diagnosticBytes +=
        Buffer.byteLength(finding.path) + Buffer.byteLength(finding.issue);
    }
    expect(diagnosticBytes).toBeLessThanOrEqual(
      EXECUTABLE_SKILL_DIAGNOSTIC_BYTE_LIMIT,
    );
    for (const finding of findings) {
      expect(finding.path.length).toBeLessThanOrEqual(512);
      expect(finding.issue.length).toBeLessThanOrEqual(512);
      for (const dangerousCharacter of [
        ':',
        '\\',
        '\n',
        '\u0007',
        '\u2028',
        '\u2029',
        '\u202e',
        '\u206a',
        '\u206f',
      ]) {
        expect(finding.path).not.toContain(dangerousCharacter);
      }
      expect(finding.issue).not.toContain('colon');
    }
  } finally {
    await rm(repoRoot, REMOVE_OPTIONS);
  }
});
