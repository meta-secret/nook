export type AuditedSourceSeam = {
  readonly digest: string | false;
  readonly marker: string;
  readonly sourcePath: string;
  readonly specifier: string;
  readonly targetPath: string | false;
};
export type AuditedSourceRequest = {
  readonly source: string;
  readonly sourcePath: string | false;
  readonly targetPath: string | false;
};
export type AuditedRuntimeSourceRequest = {
  readonly path: string;
  readonly source: string;
};

const AUDITED_RUNTIME_SOURCES = new Map([
  [
    '.github/scripts/arc-hive-render-contract.ts',
    '302c268ba1a8bf17b09155635c3bc9892110acfdf1b610bbb95c93d7318cf42d',
  ],
  [
    'infra/sim/kubernetes-cache/contracts.ts',
    '6497fdf6579ce20a577a1613785baa2009562855c5ec5837ad990b717040aafc',
  ],
  [
    '.github/scripts/format-host-apply.test.sh',
    '7af6e59c95f952a7dec0b8ac4e2a4fe9d4fcd932af85a29fa528442b7c394f94',
  ],
  [
    'agentic-ai/ci-agent/scripts/exit-smoke.mjs',
    'acdc9208aa99cbedbbcac688316622757a58ea67a9df408ed0b1a6c4b536b423',
  ],
  [
    '.github/scripts/with-healthy-buildkit.sh',
    'c2d9895d55a3039a55f0ebe79932278879237a7638778b41f706fa653cdcf360',
  ],
  [
    '.github/scripts/with-remote-buildkit.sh',
    '1132f276fed615ce28a10a8a869c54d7b68c9174b2c2bb12865d9f5277042e38',
  ],
  [
    '.github/scripts/services-network-repair-test.ts',
    '936746c2aee4f6cb8b3525222d7619ab7796aa541314a466db98150a8f7fe006',
  ],
  [
    '.github/scripts/k0s-cni-migration-test.ts',
    '1399fa145b50cb4c97c7f409380c899be9c57b05db150d6e0424b1598e709ea9',
  ],
  [
    '.github/scripts/k0s-firewall-rollback-test.ts',
    '5b9fbf0739db31d91e535ad8b779f0c2cdfcfc8d484cec9679c3a9010d03fa9f',
  ],
  [
    '.github/scripts/remote-task-batch.sh',
    '02f60c3d13be6b159eebd6698a9730114ed325d167c2df6ed0f041271bbb4ced',
  ],
  [
    'infra/operator-ssh.ts',
    '4a8bddcf4f0ceef6426306157f70d450ecfc4ce894cbc6aaae5b4646548a3da6',
  ],
  [
    'infra/providers/ovh-dedicated.ts',
    'e32c98b4f3c280cf994e44b78a9df3d636beaefff82701d86b5ebaeff43a9b15',
  ],
  [
    'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts',
    'b1a958b0499e73241a967d5540c3615e66a91be43a4f1a53e9cdeccd8f85f417',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
    '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.mjs',
    '648f9893b06dd4a896608919686c7d85b45f121ca5c44e4870233d52548c7657',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
    '6b977f77b3e2724e71ee6bc4011946ff60ff46398f0940307b9cf7fd20a7c153',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
    '8d10b7f14d6bc03ded1128899a018d213b92a1864c45266c9dc4382bfd6842a2',
  ],
]);

export const AUDITED_SOURCE_SEAMS: readonly AuditedSourceSeam[] = [
  ...[
    'infra/tasks/providers.yml',
    'infra/tasks/kubernetes-tools.yml',
    'infra/tasks/k0s-workers.yml',
    'infra/tasks/mesh.yml',
  ].map((sourcePath): AuditedSourceSeam => ({
    digest: false,
    marker: '/etc/os-release',
    sourcePath,
    specifier: '/etc/os-release',
    targetPath: '/etc/os-release',
  })),
  {
    digest: 'd0414467deac76fd3d5ba4b36a2de6ee4813f7a99bbb6db83b4ef58d3a0cb0bd',
    marker: '$HIVE_TASK_DIR/prepare-sccache-context.sh',
    sourcePath: 'agentic-ai/minds/hive/Taskfile.yml',
    specifier: '$HIVE_TASK_DIR/prepare-sccache-context.sh',
    targetPath: 'agentic-ai/minds/hive/prepare-sccache-context.sh',
  },
  {
    digest: '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
    marker: '$SCRIPT_DIR/hosted-extension.sh',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.test.sh',
    specifier: './hosted-extension.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
  },
  {
    digest: '6b977f77b3e2724e71ee6bc4011946ff60ff46398f0940307b9cf7fd20a7c153',
    marker: '$SCRIPT_DIR/setup-brave-vault.sh',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.test.sh',
    specifier: './setup-brave-vault.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
  },
  {
    digest: '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
    marker: '$HOSTED_INSTALLER',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
    specifier: './hosted-extension.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
  },
  {
    digest: '8d10b7f14d6bc03ded1128899a018d213b92a1864c45266c9dc4382bfd6842a2',
    marker: '$SCRIPT_DIR/test-hosted-smoke.sh',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.test.sh',
    specifier: './test-hosted-smoke.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
  },
];

export function isAuditedSource(request: AuditedSourceRequest): boolean {
  const specifier = request.source.replace(/^["']|["']$/gu, '');
  return AUDITED_SOURCE_SEAMS.some(
    (seam) =>
      seam.sourcePath === request.sourcePath &&
      (seam.specifier === specifier ||
        seam.marker === specifier ||
        seam.targetPath === specifier) &&
      seam.targetPath === request.targetPath &&
      seamDigestMatches(seam),
  );
}

export function assertAuditedSource([runtime, state, words]: readonly [
  string,
  ShellParseState,
  readonly ShellWord[],
]): void {
  const executable = words[0];
  if (runtime === '.' && !executable) return;
  if (executable && words.length === 1) {
    const wordRequest: WordEnvironmentRequest = {
      environment: state.environment,
      word: executable,
    };
    const target = resolveWord(wordRequest);
    const request: AuditedSourceRequest = {
      source: executable.source,
      sourcePath: state.sourcePath,
      targetPath:
        target.dynamic || state.cwdUnknown
          ? false
          : posix.normalize(posix.join(state.cwd, target.value)),
    };
    if (isAuditedSource(request)) return;
  }
  throw new Error(
    `Unsupported sourced shell execution in ${state.sourcePath || 'inline'}: ${executable?.source ?? 'missing'}`,
  );
}

function seamDigestMatches(seam: AuditedSourceSeam): boolean {
  if (seam.digest === false || seam.targetPath === false) return true;
  const source = readFileSync(
    resolve(import.meta.dir, '../../..', seam.targetPath),
  );
  return createHash('sha256').update(source).digest('hex') === seam.digest;
}
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { resolveWord } from './skill-provider-shell-environment.ts';
import type {
  ShellParseState,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

export function isAuditedRuntimeSource(
  request: AuditedRuntimeSourceRequest,
): boolean {
  const expected = AUDITED_RUNTIME_SOURCES.get(request.path);
  if (typeof expected !== 'string') return false;
  const actual = new Bun.CryptoHasher('sha256')
    .update(request.source)
    .digest('hex');
  if (actual !== expected)
    throw new Error(`Audited runtime source has drifted: ${request.path}`);
  return true;
}
