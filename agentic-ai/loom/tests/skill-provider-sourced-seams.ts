import { createHash } from 'node:crypto';

import { readFileSync } from 'node:fs';

import { posix, resolve } from 'node:path';

import { SkillProviderShellEnvironmentScenario } from './skill-provider-shell-environment.ts';

import type {
  ShellParseState,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

export class SkillProviderSourcedSeamsScenario {
  private constructor(private readonly request: AuditedSourceRequest) {}

  static isAuditedSource(request: AuditedSourceRequest): boolean {
    return new SkillProviderSourcedSeamsScenario(request).execute();
  }

  private execute(): boolean {
    const request = this.request;
    const specifier = request.source.replace(/^["']|["']$/gu, '');
    return AUDITED_SOURCE_SEAMS.some(
      (seam) =>
        seam.sourcePath === request.sourcePath &&
        (seam.specifier === specifier ||
          seam.marker === specifier ||
          seam.targetPath === specifier) &&
        seam.targetPath === request.targetPath &&
        SkillProviderSourcedSeamsScenario.seamDigestMatches(seam),
    );
  }

  static assertAuditedSource([runtime, state, words]: readonly [
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
      const target =
        SkillProviderShellEnvironmentScenario.resolveWord(wordRequest);
      const request: AuditedSourceRequest = {
        source: executable.source,
        sourcePath: state.sourcePath,
        targetPath:
          target.dynamic || state.cwdUnknown
            ? false
            : posix.normalize(posix.join(state.cwd, target.value)),
      };
      if (SkillProviderSourcedSeamsScenario.isAuditedSource(request)) return;
    }
    const [defaulted1 = 'missing'] = [executable?.source];
    throw new Error(
      `Unsupported sourced shell execution in ${state.sourcePath || 'inline'}: ${defaulted1}`,
    );
  }

  static seamDigestMatches(seam: AuditedSourceSeam): boolean {
    if (seam.digest === false || seam.targetPath === false) return true;
    const source = readFileSync(
      resolve(import.meta.dir, '../../..', seam.targetPath),
    );
    return createHash('sha256').update(source).digest('hex') === seam.digest;
  }

  static isAuditedRuntimeSource(request: AuditedRuntimeSourceRequest): boolean {
    const expected = AUDITED_RUNTIME_SOURCES.get(request.path);
    if (typeof expected !== 'string') return false;
    const actual = new Bun.CryptoHasher('sha256')
      .update(request.source)
      .digest('hex');
    if (actual !== expected)
      throw new Error(`Audited runtime source has drifted: ${request.path}`);
    return true;
  }
}
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
    'agentic-ai/loom/tests/repository-command.fixture.cjs',
    '054562f3874994116b179f4b99ae3760a4b63e1f2c6bc443c19f7aa215dca7a2',
  ],
  [
    '.github/scripts/arc-hive-render-contract.ts',
    '6e3f9ec99a5f65a720e8af6e9c9331d76750148c58d3cecdc9569352a9b93ad1',
  ],
  [
    'infra/sim/kubernetes-cache/contracts.ts',
    '414fe9bbc3c8405974607ccd0ff34892084d1047322dbd26072b4b19cd2ec0f5',
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
    'c2c3b61e2e5fbee58adf9b4ad3b5a79cbfeaa832a38f3129f162474e64a309fd',
  ],
  [
    '.github/scripts/k0s-cni-migration-test.ts',
    'a30edf07fc77baa8ecda6894b9f0845f04754a5b814fa0a3d50fcbac71736a81',
  ],
  [
    '.github/scripts/k0s-firewall-rollback-test.ts',
    '29a99be57360e1471993627d63f0d4064ae0b76e11f0d8a9e6f540e71c3ba7b8',
  ],
  [
    '.github/scripts/remote-task-batch.sh',
    'c9dc8b2c289f86eef744244c57166d91770729e3c181fc48de3a480075028aba',
  ],
  [
    'infra/operator-ssh.ts',
    'e2f949bdb73bdd874c1e620acf2fa66ad13ccae8f5864afd2dd1fac68acb0e38',
  ],
  [
    'infra/providers/ovh-dedicated.ts',
    'b0313dcc087492bdeb5c47a2a5dc9f76bcc7199a8dadfaab308582cc56f18caa',
  ],
  [
    'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts',
    '998f45b0027db1f638e1f803c33eb3668199f7848d04c45c5fb337bda201dfe6',
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
    'infra/tasks/k0s-worker-restore.yml',
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
