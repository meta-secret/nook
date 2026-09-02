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
    '36e7c75dd8c5661213cf04398f36c2d084043c0c57237c16232982c1fd4a6e1c',
  ],
  [
    'infra/sim/kubernetes-cache/contracts.ts',
    'cce43622b18c40f64c020bd262d97e55d1193dcb13066a4dd6a6bcdb2de94a96',
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
    'b721ee0fe9e8515b625a11e14a3ba598b0b4fdb42f821dbaafd2b7e3f7915bcd',
  ],
  [
    '.github/scripts/k0s-cni-migration-test.ts',
    '177eaf8c2fb1087f7305f15dc6d28df2b5d6861407f4bd055bd2f19293ae0abb',
  ],
  [
    '.github/scripts/k0s-firewall-rollback-test.ts',
    '2eb7c30dd3399c84729ae971b8cf078e0506806fda19925f764af15e52410955',
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
    '82bb56a284546337e64c39d2205d674ecddaf830bcbc85075132092c1569665e',
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
    'ec3010f2f755694e1962b6a42b7ccc5c17618d30e42d1694c14bbd2484c992d9',
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
  const [defaulted1 = 'missing'] = [executable?.source];
  throw new Error(
    `Unsupported sourced shell execution in ${state.sourcePath || 'inline'}: ${defaulted1}`,
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
