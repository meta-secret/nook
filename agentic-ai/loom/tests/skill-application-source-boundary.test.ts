import { join, posix } from 'node:path';
import { expect, test } from 'bun:test';
import ts from 'typescript';
import {
  type AnalyzeExecutableSkillSourceRequest,
  analyzeExecutableSkillSource,
  isExecutableSkillApplicationSourcePath,
} from '../src/executable-skills/source-policy.ts';
import {
  executableSkillPackageFromPath,
  executableSkillPackages,
  readTrackedRepositoryFiles,
} from '../src/executable-skills/repository.ts';
const REPOSITORY_ROOT = join(import.meta.dir, '../../..');
const AI_SKILLS = '.cortex/teams/ai/dynamic-skills/';
const HOST_ROOT = `${AI_SKILLS}executable-skill-host/scripts/src/`;
const ARTICLE_ROOT =
  '.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/';
const HOST_CLI = `${HOST_ROOT}cli.ts`;
const YAML_CODEC = `${HOST_ROOT}skill-yaml-codec.ts`;
const semicolons = (source: string): string[] => source.split(';');
const HOST_CALLS = semicolons(
  `closeSync(descriptor);fstatSync(descriptor);fstatSync(descriptor);openSync( invocation.requestPath, constants.O_RDONLY | constants.O_NONBLOCK, );readSync( descriptor, bytes, length, bytes.length - length, length, )`,
);
const HOST_CONSTANT_USES = 'constants.O_NONBLOCK constants.O_RDONLY'.split(' ');
const PROCESS_USES = semicolons(
  `process.argv.slice(2);process.exitCode = outcome.exitCode;process.stdout.write(outcome.yaml)`,
);
const FORBIDDEN_HOST_GLOBALS = new Set(
  `alert Bun confirm Date Math console crypto performance prompt reportError`.split(
    ' ',
  ),
);
export function analyzeSkillHostSource(
  request: AnalyzeExecutableSkillSourceRequest,
) {
  const { relativePath, source } = request;
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const retained = source.split('');
  const constantUses: string[] = [];
  const hostUses: string[] = [];
  const processUses: string[] = [];
  const erase = (node: ts.Node): string[] =>
    retained.fill(' ', node.getFullStart(), node.getEnd());
  const compact = (node: ts.Node): string =>
    node.getText(sourceFile).replace(/\s+/gu, ' ');
  const allowedExternalImport = (node: ts.ImportDeclaration): boolean => {
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.attributes)
      return false;
    const expected =
      relativePath === HOST_CLI && node.moduleSpecifier.text === 'node:fs'
        ? 'closeSync constants fstatSync openSync readSync'.split(' ')
        : relativePath === YAML_CODEC && node.moduleSpecifier.text === 'yaml'
          ? 'CST Lexer ParsedNode isAlias isMap isScalar isSeq parseDocument stringify'.split(
              ' ',
            )
          : [];
    const elements =
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
        ? node.importClause.namedBindings.elements
        : [];
    return (
      expected.length > 0 &&
      !node.importClause?.name &&
      elements.length === expected.length &&
      elements.every(
        (element) =>
          !element.propertyName && expected.includes(element.name.text),
      )
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_HOST_GLOBALS.has(node.text))
      throw new Error('Forbidden host output, clock, or entropy capability.');
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.') &&
      !posix
        .normalize(
          posix.join(posix.dirname(relativePath), node.moduleSpecifier.text),
        )
        .startsWith(HOST_ROOT)
    )
      throw new Error('Host imports must remain inside its scripts project.');
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.moduleSpecifier.text.startsWith('.')
    ) {
      if (!allowedExternalImport(node))
        throw new Error(`Forbidden host import: ${relativePath}`);
      erase(node);
      return;
    }
    if (ts.isIdentifier(node) && node.text === 'process') {
      const property = node.parent;
      const operation = ts.isPropertyAccessExpression(property)
        ? property.name.text === 'exitCode'
          ? property.parent
          : property.parent.parent
        : property;
      const use = compact(operation);
      if (
        relativePath !== HOST_CLI ||
        !PROCESS_USES.includes(use as (typeof PROCESS_USES)[number]) ||
        processUses.includes(use)
      )
        throw new Error('Forbidden host process capability.');
      processUses.push(use);
      retained.splice(node.getStart(), node.getWidth(), ...'allowed');
    }
    if (
      relativePath === HOST_CLI &&
      ts.isIdentifier(node) &&
      HOST_CALLS.some((call) => call.startsWith(`${node.text}(`))
    ) {
      if (!ts.isCallExpression(node.parent) || node.parent.expression !== node)
        throw new Error('Forbidden host filesystem capability.');
      hostUses.push(compact(node.parent));
    }
    if (
      relativePath === HOST_CLI &&
      ts.isIdentifier(node) &&
      node.text === 'constants'
    ) {
      const property = node.parent;
      const use =
        ts.isPropertyAccessExpression(property) && property.expression === node
          ? compact(property)
          : '';
      if (
        !HOST_CONSTANT_USES.includes(
          use as (typeof HOST_CONSTANT_USES)[number],
        ) ||
        constantUses.includes(use)
      ) {
        throw new Error('Forbidden host filesystem constant capability.');
      }
      constantUses.push(use);
      retained.splice(node.getStart(), node.getWidth(), ...'safeValue');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (
    relativePath === HOST_CLI &&
    (hostUses.sort().join() !== [...HOST_CALLS].sort().join() ||
      constantUses.sort().join() !== [...HOST_CONSTANT_USES].sort().join() ||
      processUses.sort().join() !== [...PROCESS_USES].sort().join())
  )
    throw new Error('Host capabilities must use the exact bounded seam.');
  const analysisPath = `${HOST_ROOT}contained/src/${posix.basename(relativePath)}`;
  const analysisRequest = {
    relativePath: analysisPath,
    source: retained
      .join('')
      .replace(/\bObject\.entries\b/gu, 'Object.values')
      .replace(/\binstanceof Object\b/gu, 'instanceof SafeObject'),
  };
  return analyzeExecutableSkillSource(analysisRequest);
}

type ExecutableSkillSourceProfile = typeof analyzeExecutableSkillSource;
const SOURCE_PROFILES: ReadonlyMap<string, ExecutableSkillSourceProfile> =
  new Map([
    [ARTICLE_ROOT.slice(0, -5), analyzeExecutableSkillSource],
    [HOST_ROOT.slice(0, -5), analyzeSkillHostSource],
  ]);

function executableSkillRootFromTrackedPath(path: string): string | false {
  const skillPackage = executableSkillPackageFromPath(path);
  return skillPackage !== false &&
    isExecutableSkillApplicationSourcePath(
      `${skillPackage.scriptsRoot}/src/index.ts`,
    )
    ? skillPackage.scriptsRoot
    : false;
}

test('all tracked executable application sources pass the AST capability gate', async () => {
  const trackedFiles = readTrackedRepositoryFiles(REPOSITORY_ROOT);
  const tracked = trackedFiles.map((file) => file.path);
  const packageRoots = executableSkillPackages(trackedFiles)
    .map((skillPackage) => skillPackage.scriptsRoot)
    .filter((root) =>
      isExecutableSkillApplicationSourcePath(`${root}/src/index.ts`),
    );
  const implementationRoots = [
    ...new Set(
      tracked.flatMap((path) => {
        const root = executableSkillRootFromTrackedPath(path);
        return root === false ? [] : [root];
      }),
    ),
  ].sort();
  expect(implementationRoots).toEqual(packageRoots);
  expect([...SOURCE_PROFILES.keys()].sort()).toEqual(packageRoots);
  for (const root of packageRoots) {
    const skillRoot = posix.dirname(root);
    const slug = posix.basename(skillRoot);
    expect(tracked).not.toContain(`${skillRoot}.md`);
    for (const required of [
      `${skillRoot}/SKILL.md`,
      `${root}/bun.lock`,
      `${root}/executable-skill.json`,
    ]) {
      expect(tracked, required).toContain(required);
    }
    for (const requiredDirectory of [`${root}/src/`, `${root}/tests/`]) {
      expect(
        tracked.some((path) => path.startsWith(requiredDirectory)),
        requiredDirectory,
      ).toBe(true);
    }
    for (const file of trackedFiles.filter(
      (candidate) =>
        candidate.path === `${skillRoot}/SKILL.md` ||
        candidate.path.startsWith(`${root}/`),
    )) {
      expect(file.mode, file.path).toBe('100644');
    }
    const skill = await Bun.file(
      join(REPOSITORY_ROOT, skillRoot, 'SKILL.md'),
    ).text();
    const packageDocument = await Bun.file(
      join(REPOSITORY_ROOT, root, 'package.json'),
    ).text();
    const lockfile = await Bun.file(
      join(REPOSITORY_ROOT, root, 'bun.lock'),
    ).text();
    expect(skill.startsWith(`---\nname: ${slug}\ndescription:`)).toBe(true);
    expect(packageDocument).toContain(`"name": "@nook/${slug}-skill"`);
    expect(lockfile).toContain(`"name": "@nook/${slug}-skill"`);
  }
  const sources = tracked.filter(isExecutableSkillApplicationSourcePath);
  expect(sources.length).toBeGreaterThan(0);
  for (const path of sources) {
    const packageRoot = packageRoots.find((root) =>
      path.startsWith(`${root}/src/`),
    );
    const profile = packageRoot
      ? (SOURCE_PROFILES.get(packageRoot) ?? false)
      : false;
    expect(profile, path).not.toBe(false);
    if (profile === false) throw new Error(`Missing source profile: ${path}`);
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const analysisRequest = { relativePath: path, source };
    const analysis = profile(analysisRequest);
    for (const specifier of analysis.moduleSpecifiers) {
      const dependency = posix.normalize(
        posix.join(posix.dirname(path), specifier),
      );
      expect(sources, `${path} -> ${specifier}`).toContain(dependency);
    }
    if (path !== HOST_CLI)
      expect(source, path).not.toContain('import.meta.main');
    expect(source, path).not.toMatch(
      /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+run\b/u,
    );
  }
  const manifests = tracked.filter((path) =>
    path.endsWith('/scripts/executable-skill.json'),
  );
  expect(manifests).toContain(
    `${ARTICLE_ROOT.slice(0, -4)}executable-skill.json`,
  );
  for (const path of manifests) {
    const manifest = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    expect(manifest).not.toMatch(/"(?:command|entrypoint)"/u);
  }
});

test('rejects dangerous capabilities from every host layer', async () => {
  const host = await Bun.file(join(REPOSITORY_ROOT, HOST_CLI)).text();
  const mutate = (change: string): string => {
    const parts = change.split('§');
    return host.replace(parts[0] ?? '', parts[1] ?? '');
  };
  const mutations = [
    "constants.O_RDONLY | constants.O_NONBLOCK§openSync('/tmp/pwn', 'w')",
    'process.stdout.write(outcome.yaml)§process.stdout.write(bytes)',
    'const count = readSync(§const rebound = readSync;\nconst count = rebound(',
  ].map(mutate);
  const registry = `${HOST_ROOT}skill-action-registry.ts`;
  const schema = `${HOST_ROOT}skill-schema-validator.ts`;
  const fixtures = [
    [HOST_CLI, 'process.env.SECRET;'],
    [HOST_CLI, 'const secret = "secret"; alert(secret);'],
    [HOST_CLI, 'const secret = "secret"; confirm(secret); prompt(secret);'],
    [HOST_CLI, 'const secret = new Error("secret"); reportError(secret);'],
    ...mutations.map((source) => [HOST_CLI, source] as const),
    [HOST_CLI, "import { readFileSync as fetch, statSync } from 'node:fs';"],
    [HOST_CLI, `${host}\nconstants.O_CREAT = constants.O_RDONLY;`],
    [YAML_CODEC, "import x from 'arbitrary-package';"],
    [registry, "import { spawn } from 'node:child_process';"],
    [schema, "void import('./skill-command-domain.ts');"],
  ] as const;
  for (const [path, source] of fixtures) {
    const request = { relativePath: path, source };
    expect(() => analyzeSkillHostSource(request), path).toThrow();
  }
});

test('does not exempt misspelled team owners from repository source policy', () => {
  const typoPath = ARTICLE_ROOT.replace('/ai/', '/a1/').concat('src/audit.ts');
  expect(isExecutableSkillApplicationSourcePath(typoPath)).toBe(false);
  expect(
    isExecutableSkillApplicationSourcePath(`${ARTICLE_ROOT}src/audit.ts`),
  ).toBe(true);
});

test('derives package roots from the final scripts delimiter', () => {
  const source =
    '.cortex/teams/ai/dynamic-skills/scripts/scripts/src/application.ts';
  expect(executableSkillRootFromTrackedPath(source)).toBe(
    '.cortex/teams/ai/dynamic-skills/scripts/scripts',
  );
});
