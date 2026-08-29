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
  readonly sources: ReadonlyMap<string, string>;
  readonly workingDirectory: string;
};

type TsconfigDocument = {
  readonly extends?: string | readonly string[];
  readonly compilerOptions?: {
    readonly baseUrl?: string;
    readonly paths?: Readonly<Record<string, readonly string[]>>;
  };
};

type TsconfigAliasRequest = {
  readonly depth: number;
  readonly path: string;
  readonly request: ResolutionCandidateRequest;
  readonly visited: ReadonlySet<string>;
};

type PositionalSpecializationRequest = {
  readonly arguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
};
const MODULE_SUFFIXES = 'ts tsx mts cts js jsx mjs cjs'
  .split(' ')
  .map((suffix) => `.${suffix}`);
const MAX_TSCONFIG_EXTENDS_DEPTH = 16;
export const ACTION_SOURCE_SUFFIXES = ['', ...MODULE_SUFFIXES] as const;
export const CONFIGURATION_GRAPH_LIMITS = {
  arguments: 256,
  depth: 32,
  stateBytes: 65_536,
  states: 4_096,
} as const;
const AUDITED_NODE_EVAL_COMMAND_DIGESTS = new Map<string, string>([
  [
    '.github/workflows/agent-implement.yml',
    '56531d77488fefab8ce870dc24942bffdda5b828cd761eeca5b58167b503476f',
  ],
  [
    '.task/agentic-ai.yml',
    'aa81b457c8f43b93e64cd4f7b1ccbd3371338bc965ff7bea10c58dead505a5ff',
  ],
  [
    '.task/ai-debug.yml',
    '52258309733346901e9962cecc19927e86e142140563575277abe3e362553e2d',
  ],
]);

export function isRunnableConfiguration(path: string): boolean {
  return (
    /(^|\/)package\.json$/u.test(path) ||
    /(^|\/)Taskfile(?:\.[^/]*)?\.ya?ml$/u.test(path) ||
    /(^|\/)bunfig\.toml$/u.test(path) ||
    /^\.task\/(?:[^/]+\/)*[^/]+\.ya?ml$/u.test(path) ||
    /(^|\/)vite\.config\.(?:[cm]?[jt]s)$/u.test(path) ||
    /(^|\/)svelte\.config\.(?:[cm]?[jt]s)$/u.test(path) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path) ||
    /(^|\/)action\.ya?ml$/u.test(path)
  );
}

export function isActionManifest(path: string): boolean {
  return /(^|\/)action\.ya?ml$/u.test(path);
}

export function actionSourceRequiresContent(path: string): boolean {
  return (
    isActionManifest(path) ||
    /\.(?:[cm]?tsx?|[cm]?jsx?)$/u.test(path) ||
    posix.extname(path) === '' ||
    path.endsWith('package.json')
  );
}

export function configurationRootWorkingDirectory(path: string): string {
  if (
    !/(^|\/)(?:package\.json|bunfig\.toml|(?:vite|svelte)\.config\.(?:[cm]?[jt]s))$/u.test(
      path,
    )
  )
    return '';
  return posix.dirname(path).replace(/^\.$/u, '');
}

export function resolutionCandidates(
  request: ResolutionCandidateRequest,
): readonly string[] {
  const importerDirectory = posix.dirname(request.importer);
  const sourceSpecifier = request.specifier
    .replace(/(^|\/)dist\//u, '$1src/')
    .replace(/\.([mc]?)js$/u, '.$1ts');
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
      [...bases, ...tsconfigAliasBases(request)].flatMap((path) =>
        moduleCandidates([path, request.exactFirst]),
      ),
    ),
  ];
}

function tsconfigAliasBases(
  request: ResolutionCandidateRequest,
): readonly string[] {
  if (/^(?:\.|\/|node:)/u.test(request.specifier)) return [];
  let directory = posix.dirname(request.importer).replace(/^\.$/u, '');
  while (true) {
    const path = directory ? `${directory}/tsconfig.json` : 'tsconfig.json';
    const source = request.sources.get(path);
    if (source && source.length > 0) {
      const aliasRequest: TsconfigAliasRequest = {
        depth: 0,
        path,
        request,
        visited: new Set(),
      };
      return aliasesFromTsconfig(aliasRequest);
    }
    if (!directory) return [];
    const parent = posix.dirname(directory).replace(/^\.$/u, '');
    if (parent === directory) return [];
    directory = parent;
  }
}

function aliasesFromTsconfig(
  aliasRequest: TsconfigAliasRequest,
): readonly string[] {
  if (aliasRequest.depth > MAX_TSCONFIG_EXTENDS_DEPTH)
    throw new Error('Runnable tsconfig extends chain exceeds its bound.');
  if (aliasRequest.visited.has(aliasRequest.path))
    throw new Error(`Runnable tsconfig extends cycle: ${aliasRequest.path}`);
  const source = aliasRequest.request.sources.get(aliasRequest.path);
  if (!source)
    throw new Error(
      `Runnable tsconfig extends target is untracked: ${aliasRequest.path}`,
    );
  assertRunnableConfigurationBytes(source);
  let document: TsconfigDocument;
  try {
    document = Bun.JSONC.parse(source) as TsconfigDocument;
  } catch {
    throw new Error(`Runnable tsconfig is invalid: ${aliasRequest.path}`);
  }
  const options = document.compilerOptions;
  const mappings = options?.paths ?? {};
  const baseUrl = options?.baseUrl ?? '.';
  if (typeof baseUrl !== 'string')
    throw new Error(
      `Runnable tsconfig baseUrl is invalid: ${aliasRequest.path}`,
    );
  for (const [alias, targets] of Object.entries(mappings)) {
    const wildcard = alias.indexOf('*');
    if (wildcard !== alias.lastIndexOf('*'))
      throw new Error(`Runnable tsconfig alias is unsupported: ${alias}`);
    const prefix = wildcard < 0 ? alias : alias.slice(0, wildcard);
    const suffix = wildcard < 0 ? '' : alias.slice(wildcard + 1);
    if (
      !aliasRequest.request.specifier.startsWith(prefix) ||
      !aliasRequest.request.specifier.endsWith(suffix) ||
      (wildcard < 0 && aliasRequest.request.specifier !== alias)
    )
      continue;
    if (!Array.isArray(targets) || targets.length === 0)
      throw new Error(`Runnable tsconfig alias target is invalid: ${alias}`);
    const substitution = aliasRequest.request.specifier.slice(
      prefix.length,
      aliasRequest.request.specifier.length - suffix.length,
    );
    return targets.map((target) => {
      if (typeof target !== 'string' || target.includes('*') !== wildcard >= 0)
        throw new Error(`Runnable tsconfig alias target is invalid: ${alias}`);
      const resolvedTarget = target.replace('*', substitution);
      const candidate = posix.normalize(
        posix.join(posix.dirname(aliasRequest.path), baseUrl, resolvedTarget),
      );
      if (candidate.startsWith('../') || candidate.startsWith('/'))
        throw new Error(`Runnable tsconfig alias escapes repository: ${alias}`);
      return candidate;
    });
  }
  const inherited = document.extends;
  if (!('extends' in document)) return [];
  const parents = typeof inherited === 'string' ? [inherited] : inherited;
  if (
    !Array.isArray(parents) ||
    parents.some((parent) => typeof parent !== 'string')
  )
    throw new Error(
      `Runnable tsconfig extends is invalid: ${aliasRequest.path}`,
    );
  const visited = new Set(aliasRequest.visited).add(aliasRequest.path);
  for (const parent of [...parents].reverse()) {
    if (!parent.startsWith('.')) continue;
    const base = posix.normalize(
      posix.join(posix.dirname(aliasRequest.path), parent),
    );
    if (base.startsWith('../') || base.startsWith('/'))
      throw new Error(
        `Runnable tsconfig extends escapes repository: ${parent}`,
      );
    if (/(^|\/)node_modules\//u.test(base)) continue;
    const candidates = posix.extname(base) ? [base] : [base, `${base}.json`];
    const path = candidates.find((candidate) =>
      aliasRequest.request.sources.has(candidate),
    );
    if (!path)
      throw new Error(
        `Runnable tsconfig extends target is untracked: ${parent}`,
      );
    const parentRequest: TsconfigAliasRequest = {
      depth: aliasRequest.depth + 1,
      path,
      request: aliasRequest.request,
      visited,
    };
    const aliases = aliasesFromTsconfig(parentRequest);
    if (aliases.length > 0) return aliases;
  }
  return [];
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
        '3f2071b04769ac9daabab25ef4eb3d78ab5dd575518da062acde130389466313'
    )
      return 'true';
    throw new Error('Unaudited AGENT_EOF shell exemption.');
  }
  const protectedPath =
    /(?:\.agents\/skills|\.cortex\/(?:gizmo|shared|teams\/[^/]+)\/dynamic-skills)/u;
  const trustedWorkspaceCommands =
    sourcePath === '.github/workflows/agent-implement.yml'
      ? source
          .replaceAll(
            'node "$GITHUB_WORKSPACE/agentic-ai/ci-agent/dist/main/main.js" edit',
            "node 'agentic-ai/ci-agent/dist/main/main.js' edit",
          )
          .replaceAll(
            'node "$GITHUB_WORKSPACE/agentic-ai/ci-agent/dist/main/main.js" deliver',
            "node 'agentic-ai/ci-agent/dist/main/main.js' deliver",
          )
      : source;
  const normalized = trustedWorkspaceCommands
    .replaceAll('\\`', '')
    .replace(
      /\bformatter_root="\$\{NOOK_FORMATTER_ROOT:-\/opt\/nook-formatter\}"/gu,
      'formatter_root=.',
    )
    .replace(/\bbash "\$formatter_root\/format\.sh"/gu, 'true')
    .replaceAll('/meta-secret/nook/', '')
    .replace(/\bnode (?:-e|--eval) (?:"[^"]*"|'[^']*')/gu, (command) => {
      const expectedDigest = AUDITED_NODE_EVAL_COMMAND_DIGESTS.get(sourcePath);
      const actualDigest = new Bun.CryptoHasher('sha256')
        .update(command)
        .digest('hex');
      if (actualDigest === expectedDigest) return 'node --version';
      throw new Error(`Node eval execution is forbidden: ${sourcePath}`);
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
