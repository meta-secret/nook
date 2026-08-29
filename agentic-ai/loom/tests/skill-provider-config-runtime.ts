import { posix } from 'node:path';
import type { ShellLaunchArgument } from './skill-provider-command-types.ts';

type ResolutionCandidateRequest = {
  readonly importer: string;
  readonly packageRoot: string;
  readonly specifier: string;
};

type PositionalSpecializationRequest = {
  readonly arguments: readonly ShellLaunchArgument[] | false;
  readonly source: string;
};

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
  return [
    posix.normalize(posix.join(importerDirectory, request.specifier)),
    posix.normalize(posix.join(importerDirectory, sourceSpecifier)),
    posix.normalize(posix.join(request.packageRoot, request.specifier)),
    posix.normalize(request.specifier.replace(/^\.\//u, '')),
    posix.normalize(sourceSpecifier.replace(/^\.\//u, '')),
  ];
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

export function normalizeConfigurationShellSource(source: string): string {
  if (
    source.includes('delim="AGENT_EOF_') &&
    !/(?:^|[;&|]\s*)(?:bash|bun|node|sh|source)\b/mu.test(source)
  )
    return 'true';
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
    .replace(/\bnode (?:-e|--eval) (?:"[^"]*"|'[^']*')/gu, (command) =>
      protectedPath.test(command) ? command : 'node --version',
    )
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
      /\b([A-Za-z_]\w*)="\$\(cd "\$\(dirname "(?:\$0|\$\{BASH_SOURCE\[0\]\})"\)(?:\/\.\.)*" && pwd\)"/gu,
      '$1=.',
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
