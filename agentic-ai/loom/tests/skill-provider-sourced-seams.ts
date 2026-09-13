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
    '.github/actions/nook-cache-connect/main.js',
    'dcfea6914dcbaacf66bf1782dd23c63a5314deb9072cb4d2b504502ba534a187',
  ],
  [
    '.github/scripts/workbench-publish.cjs',
    '13ea52eb03efd9af5133fc810aeb67a85176d1dd30bb7f884a159d05be3280f1',
  ],
  [
    '.github/workflows/lib/linear-ui-demo.cjs',
    'a52477a1e74c01cebd9d4f9c8de03790e1426cd15e2ddffcd34a85e5e2052fa4',
  ],
  [
    'agentic-ai/loom/src/dev-delivery/dev-command.ts',
    '220e7aa593817fbc849cee1025b2d05ae608f9cfd2735d3f499e4cc020898324',
  ],
  [
    'infra/contracts/dockerized-rust.test.ts',
    '694df9d56073e6a1b76593f7a9657905fc9a0f9b85789fcb5f0255fe38a74d80',
  ],
  [
    'agentic-ai/loom/tests/repository-command.fixture.cjs',
    '4476880c01a245ebf6aa42b3e15a7a4f8dfa433c2d43f5bfb80265aa83fb6989',
  ],
  [
    'infra/contracts/arc-hive-render-contract.ts',
    '6e3f9ec99a5f65a720e8af6e9c9331d76750148c58d3cecdc9569352a9b93ad1',
  ],
  [
    'infra/sim/kubernetes-cache/contracts.ts',
    'c0619a1141f15ad1d83e13e4d96f87651732908f19663ac0c8287a4316dbabd7',
  ],
  [
    '.github/formatting/format-host-apply.test.sh',
    'e44aea2003c2c450684c4a1ab5ae85d76d2adeba855840e77c2a2b1fd83ff280',
  ],
  [
    'agentic-ai/ci-agent/scripts/exit-smoke.mjs',
    '04d7882c2251f37d2ebf80913200487c835524a23ef5119ca62f24f0f24a755e',
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
    'infra/contracts/services-network-repair-test.ts',
    '5f31d641f1e009e7d018ebfbb9ebea63a165baad1a7bc288d96af457137daaa2',
  ],
  [
    'infra/contracts/k0s-cni-migration-test.ts',
    '95a0b4d0988be5f2948a1bf8e7895c14d0bb7b405d30c619d93481f272baf0ba',
  ],
  [
    'infra/contracts/k0s-firewall-rollback-test.ts',
    'fcb88b6d082c36b4d1865471610309fadfc2e37125d61f1b2679a731b96a2df8',
  ],
  [
    '.github/scripts/remote-task-batch.sh',
    'fb545bae3ce8b7e4fabcdc8f15e5efb7220e7389e10cb8670f012a992543f1a4',
  ],
  [
    'infra/operator-ssh.ts',
    '89e0c14ca66093c1febe3411ec40bdbeba2468e59d697142b0213a1ef71920ca',
  ],
  [
    'infra/providers/ovh-dedicated.ts',
    '36f5cb338983aba88a971674f1337731c83b50a30e74e4aeee852f9ad87f15e0',
  ],
  [
    'nook-app/nook-web/nook-web-app/scripts/verify-app-isolation.ts',
    '64551645ae8b751d33bee882b8f742227799013ab071d76b4594091d21d2f6e7',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
    '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.mjs',
    '733ddc1c96230b73e248c8117d0315e47d6f6e5c851cf02c0c05c3e70b633e43',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
    '6b977f77b3e2724e71ee6bc4011946ff60ff46398f0940307b9cf7fd20a7c153',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
    'e75257d97999373062da11a90e9d22d5b68d7266de868f4a3e972c2f1b8309c4',
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
    digest: 'e75257d97999373062da11a90e9d22d5b68d7266de868f4a3e972c2f1b8309c4',
    marker: '$SCRIPT_DIR/test-hosted-smoke.sh',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.test.sh',
    specifier: './test-hosted-smoke.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/test-hosted-smoke.sh',
  },
];
