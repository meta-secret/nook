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

  static isAuditedDynamicExecutable(request: {
    readonly executable: string;
    readonly sourcePath: string | false;
  }): boolean {
    if (request.sourcePath === false) return false;
    const expected = AUDITED_DYNAMIC_EXECUTABLES.get(
      `${request.sourcePath}:${request.executable}`,
    );
    if (typeof expected !== 'string') return false;
    const source = readFileSync(
      resolve(import.meta.dir, '../../..', request.sourcePath),
    );
    return createHash('sha256').update(source).digest('hex') === expected;
  }

  static isAuditedCommandExecutingFind(sourcePath: string | false): boolean {
    if (sourcePath === false) return false;
    const expected = AUDITED_COMMAND_EXECUTING_FIND.get(sourcePath);
    if (typeof expected !== 'string') return false;
    const source = readFileSync(
      resolve(import.meta.dir, '../../..', sourcePath),
    );
    return createHash('sha256').update(source).digest('hex') === expected;
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

const AUDITED_DYNAMIC_EXECUTABLES = new Map([
  [
    '.github/scripts/verify-github-delivery-policy.sh:$gh_bin',
    'd41d7290b77f50ace0e99b8f28dc87b11f2c22cb8b0113965611b6faf03c6651',
  ],
  [
    '.github/workflows/remote.yml:"$node_bin"',
    'a74a8e8f2571709c36efe485b19c51cc5c20d7d0d894e2efceff586064b2aac6',
  ],
  [
    '.github/workflows/remote.yml:"$jq_root/jq"',
    'a74a8e8f2571709c36efe485b19c51cc5c20d7d0d894e2efceff586064b2aac6',
  ],
]);

const AUDITED_COMMAND_EXECUTING_FIND = new Map<string, string>();

const AUDITED_RUNTIME_SOURCES = new Map([
  [
    '.github/actions/nook-cache-connect/main.js',
    '2a5052024b204660e51efe455bce752c603d70e8e7c36e4118a25834516ac036',
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
    'agentic-ai/loom/src/lib/run.ts',
    '8bee6ac341fecf756a0323ecaa509bf82617cc9b4a51f9999ec3a5709a4c25f3',
  ],
  [
    'agentic-ai/loom/src/module-experts/repository-snapshot.ts',
    'c4414d19cc693f76f5d282109af62b24336052a34780476fd13d7671a7b9117d',
  ],
  [
    'agentic-ai/loom/src/commands/pr-authored-budget.ts',
    'c72e41342aa7fe2ae312e90a9f28e3baad62600c24d8744ac6b26962b1d55376',
  ],
  [
    'agentic-ai/loom/src/commands/repository-policy-toolchain.ts',
    '139ed953c7929e00f9c68afa4784ec6a934d01f608c94c88bac3d5935b3f3216',
  ],
  [
    'infra/contracts/dockerized-rust.test.ts',
    '8f8ac6e760e471d239e7ec74058b8ff769fdfba9a2ccfbd77a04994a938db8dc',
  ],
  [
    'infra/contracts/dockerized-rust-cache-registry.test.ts',
    '828dcbf75a64cb042f183ef0ca7d8e3c81235b30bbaf0f7cb44f1520f04624ce',
  ],
  [
    'agentic-ai/loom/tests/repository-command.fixture.cjs',
    '4476880c01a245ebf6aa42b3e15a7a4f8dfa433c2d43f5bfb80265aa83fb6989',
  ],
  [
    'infra/sim/kubernetes-cache/contracts.ts',
    '5a2c6e4011c5364ab9343a5959f8c439c31d7bfb772c8265d2f74b1e98415daf',
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
    '82c1c6aaca4ab333799786181bf8641d350fc99b2d877e9378921f92e52c3e5d',
  ],
  [
    'infra/contracts/k0s-firewall-rollback-test.ts',
    'fcb88b6d082c36b4d1865471610309fadfc2e37125d61f1b2679a731b96a2df8',
  ],
  [
    '.github/scripts/remote-task-batch.sh',
    'eb0719f3f0974d2a31564b55c4008438e0af81afbddc2dcc263904978e06f2ac',
  ],
  [
    '.github/scripts/type-check-report.sh',
    'fa0dd42fd4b83f590f8878a00682da6136e549ca104ca20aa15863772e601f10',
  ],
  [
    '.github/scripts/ci-pr-native-pages-build.sh',
    'e6731f208ba0e58d59b221aa70f800ac67f8fc29299a1010deb2cd44782769c2',
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
    '63d4d81f964a15fdb81529a7894501fef993a5fce9ebee94630d39aa282c3c6c',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
    '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.mjs',
    '2fefe136040aaa20f96fa95a0712539b240195d31f4ef20f30935bf237a8743c',
  ],
  [
    'nook-app/nook-web/nook-web-extension/scripts/setup-brave-vault.sh',
    'e8d392f86a032d510038d55a8eb1f7d1a0dbd472f5a5362c1829a11c11df501b',
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
    digest: '920eda984b215b325800af8e56f6af3ebf699a93f0aec0cb52b41792b16edfe9',
    marker: '$SCRIPT_DIR/hosted-extension.sh',
    sourcePath:
      'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.test.sh',
    specifier: './hosted-extension.sh',
    targetPath:
      'nook-app/nook-web/nook-web-extension/scripts/hosted-extension.sh',
  },
  {
    digest: 'e8d392f86a032d510038d55a8eb1f7d1a0dbd472f5a5362c1829a11c11df501b',
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
