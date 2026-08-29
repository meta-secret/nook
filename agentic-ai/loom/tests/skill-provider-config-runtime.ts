import { posix } from 'node:path';
import { assertRunnableConfigurationBytes } from './skill-provider-config-commands.ts';
import type { ShellLaunchArgument } from './skill-provider-command-types.ts';
import type {
  RepositoryBackedPackageSpecifierRequest,
  RepositoryPackageDocument,
} from './skill-provider-config-types.ts';

type ResolutionCandidateRequest = {
  readonly exactFirst: boolean;
  readonly importer: string;
  readonly importerRelative: boolean;
  readonly specifier: string;
  readonly workingDirectory: string;
};

type PositionalSpecializationRequest = {
  readonly arguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
};
const MODULE_SUFFIXES = 'ts tsx mts cts js jsx mjs cjs'
  .split(' ')
  .map((suffix) => `.${suffix}`);
export const ACTION_SOURCE_SUFFIXES = ['', ...MODULE_SUFFIXES] as const;
export const CONFIGURATION_GRAPH_LIMITS = {
  arguments: 256,
  depth: 32,
  stateBytes: 65_536,
  states: 4_096,
} as const;

export function isRunnableConfiguration(path: string): boolean {
  return (
    /(^|\/)package\.json$/u.test(path) ||
    /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(path) ||
    /^\.task\/(?:[^/]+\/)*[^/]+\.ya?ml$/u.test(path) ||
    /(^|\/)vite\.config\.(?:[cm]?[jt]s)$/u.test(path) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path) ||
    /^\.github\/actions\/(?:[^/]+\/)*action\.ya?ml$/u.test(path)
  );
}

export function resolutionCandidates(
  request: ResolutionCandidateRequest,
): readonly string[] {
  const importerDirectory = posix.dirname(request.importer);
  const sourceSpecifier = request.specifier
    .replace(/(^|\/)dist\//u, '$1src/')
    .replace(/\.js$/u, '.ts');
  const baseDirectory = request.importerRelative
    ? importerDirectory
    : request.workingDirectory;
  const bases = [
    posix.normalize(posix.join(baseDirectory, request.specifier)),
    posix.normalize(posix.join(baseDirectory, sourceSpecifier)),
    posix.normalize(request.specifier.replace(/^\.\//u, '')),
    posix.normalize(sourceSpecifier.replace(/^\.\//u, '')),
  ];
  return [
    ...new Set(
      bases.flatMap((path) => moduleCandidates([path, request.exactFirst])),
    ),
  ];
}

export function isRepositoryBackedPackageSpecifier(
  request: RepositoryBackedPackageSpecifierRequest,
): boolean {
  const specifier = request.specifier;
  if (specifier.startsWith('#') || specifier.startsWith('file:')) return true;
  if (specifier.startsWith('.') || specifier.startsWith('node:')) return false;
  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] ?? '');
  for (const [path, source] of request.sources) {
    if (!path.endsWith('package.json') || source.length === 0) continue;
    assertRunnableConfigurationBytes(source);
    let document: RepositoryPackageDocument;
    try {
      document = JSON.parse(source) as RepositoryPackageDocument;
    } catch {
      continue;
    }
    if (document.name === packageName) return true;
    for (const dependencies of [
      document.dependencies,
      document.devDependencies,
      document.optionalDependencies,
    ]) {
      const dependency = dependencies?.[packageName] ?? false;
      if (dependency !== false && /^(?:file|workspace):/u.test(dependency))
        return true;
    }
  }
  return false;
}

function moduleCandidates([path, exactFirst]: readonly [
  string,
  boolean,
]): readonly string[] {
  if (posix.extname(path).length > 0) return [path];
  const resolved = [
    ...MODULE_SUFFIXES.map((suffix) => `${path}${suffix}`),
    ...MODULE_SUFFIXES.map((suffix) => posix.join(path, `index${suffix}`)),
  ];
  return exactFirst ? [path, ...resolved] : [...resolved, path];
}

export function specializePositionalArguments(
  request: PositionalSpecializationRequest,
): string {
  if (request.arguments === false) return request.source;
  return request.source.replace(
    /\bprocess\.argv(?:\[(\d+)\]|\.at\((\d+)\))/gu,
    (expression) => {
      const match = /(?:\[(\d+)\]|\.at\((\d+)\))/u.exec(expression);
      const rawIndex = match?.at(1) || match?.at(2) || '0';
      const index = Number.parseInt(rawIndex, 10) - 2;
      const argument =
        request.arguments === false ? false : request.arguments.at(index);
      return argument && !argument.dynamic
        ? JSON.stringify(argument.value)
        : expression;
    },
  );
}

export function normalizeConfigurationShellSource([
  source,
  sourcePath,
]: readonly [string, string]): string {
  if (source.includes('delim="AGENT_EOF_')) {
    if (
      sourcePath === '.github/workflows/agent-implement.yml' &&
      new Bun.CryptoHasher('sha256').update(source).digest('hex') ===
        'ea60680b19621cf87a566bf9e4e526bb8134dd6a95d3fe1dcfc0fcba4eb30047'
    )
      return 'true';
    throw new Error('Unaudited AGENT_EOF shell exemption.');
  }
  const protectedPath =
    /(?:\.agents\/skills|\.cortex\/(?:gizmo|shared|teams\/[^/]+)\/dynamic-skills)/u;
  const normalized = source
    .replaceAll('\\`', '')
    .replace(
      /\bformatter_root="\$\{NOOK_FORMATTER_ROOT:-\/opt\/nook-formatter\}"/gu,
      'formatter_root=.',
    )
    .replace(/\bbash "\$formatter_root\/format\.sh"/gu, 'true')
    .replaceAll('/meta-secret/nook/', '')
    .replace(/\bnode (?:-e|--eval) (?:"[^"]*"|'[^']*')/gu, (command) => {
      if (
        protectedPath.test(command) ||
        /\b(?:import|require)\s*\(\s*["']\.{1,2}\//u.test(command)
      )
        throw new Error('Node eval repository execution is forbidden.');
      return 'node --version';
    })
    .replace(/\btimeout --kill-after=([^\s;&|]+)/gu, 'timeout --kill-after $1')
    .replace(/\bnode --test\s+[^\s;&|]+/gu, (command) =>
      protectedPath.test(command) ? command : 'node --test',
    )
    .replace(
      /"\$\{command\[@\]\}"/gu,
      /command=\(\s*docker buildx (?:bake|build)/u.test(source)
        ? 'docker'
        : '"${command[@]}"',
    )
    .replace(
      /\brepo_root="\$\{[A-Za-z_]\w*:-\$\(git rev-parse --show-toplevel\)\}"/gu,
      'repo_root=.',
    )
    .replace(
      /\b([A-Za-z_]\w*)="\$\(cd "\$\(dirname "(?:\$0|\$\{BASH_SOURCE\[0\]\})"\)((?:\/\.\.)*)" && pwd\)"/gu,
      (assignment) => {
        const match =
          /^([A-Za-z_]\w*)="\$\(cd "\$\(dirname "(?:\$0|\$\{BASH_SOURCE\[0\]\})"\)((?:\/\.\.)*)" && pwd\)"$/u.exec(
            assignment,
          );
        const name = match?.[1] ?? '';
        const ascents = match?.[2] ?? '';
        const levels =
          ascents.length === 0 ? 0 : ascents.split('/..').length - 1;
        const base = posix.dirname(sourcePath);
        return `${name}=${posix.normalize(posix.join(base, ...Array(levels).fill('..')))}`;
      },
    )
    .replace(
      /\b([A-Za-z_]\w*)="\$\(cd "\$[A-Za-z_]\w*(?:\/\.\.)+" && pwd\)"/gu,
      (assignment) => {
        const name = /^([A-Za-z_]\w*)=/u.exec(assignment)?.[1] ?? '';
        return protectedPath.test(assignment) ? assignment : `${name}=.`;
      },
    )
    .replace(
      /\bfixture_root="\$\(mktemp -d\)"/gu,
      'fixture_root=/tmp/nook-ephemeral',
    )
    .replace(/\bdocker_bin="\$\{DOCKER:-docker\}"/gu, 'docker_bin=docker')
    .replace(/PATH=(?:"[^"]*"|'[^']*'|[^\s;]+)/gu, (assignment) =>
      protectedPath.test(assignment) ? assignment : 'NOOK_AUDITED_PATH=1',
    );
  return normalized.replace(
    /\btrap\s+[^\n;]+\s+(?:ERR|EXIT|INT|TERM)(?=;|\s|$)/gu,
    (command) => (protectedPath.test(command) ? command : "trap ':' EXIT"),
  );
}
