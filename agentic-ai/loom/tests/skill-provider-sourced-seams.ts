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
    'f1f5ccdf4018460774b17dc012b4e7fb197bcaf578be2834fd44ca30f1786151',
  ],
]);

const AUDITED_COMMAND_EXECUTING_FIND = new Map([
  [
    '.github/workflows/agent-implement.yml',
    '4c35abb4a664edd5ab1100016b08ec637dd9ac0d75bebbb0a84df70a8c0e170f',
  ],
]);

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
    '.github/scripts/agent-implement-publish-workbench.cjs',
    'ded9bf5f319642fe3efcf456f144ada3e282beda01d5a8f89ae6a0fa7d2e2eb7',
  ],
  [
    '.github/workflows/lib/linear-ui-demo.cjs',
    'a52477a1e74c01cebd9d4f9c8de03790e1426cd15e2ddffcd34a85e5e2052fa4',
  ],
  [
    'agentic-ai/loom/src/dev-delivery/dev-command.ts',
    '3900ff7f3e0c9c3a86f6fd07c062e4b1d733f3961e0348b56d18bdcf6b4340b1',
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
    'agentic-ai/loom/src/agent-workflow/delegation-aggregation.ts',
    'd91c6bda5de0c6285849d09868467b8520b4bf55f8587d9afe9ea411791e6311',
  ],
  [
    'agentic-ai/loom/src/commands/pr-authored-budget.ts',
    'c72e41342aa7fe2ae312e90a9f28e3baad62600c24d8744ac6b26962b1d55376',
  ],
  [
    'agentic-ai/ci-agent/src/main/process.ts',
    '9860d5fd66331e7a0c154b1544a6a015248fdde9940b1073669e0e96d7357da7',
  ],
  [
    'infra/contracts/dockerized-rust.test.ts',
    'a2d550d69c76d829deb9a3345c3f6785f3e44e771de07329b2106ceb082537d2',
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
    '073947efded4373ef02d7ca9d017ea9d82cad28b4329cf664acaca7ca723e2b2',
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
    '2fefe136040aaa20f96fa95a0712539b240195d31f4ef20f30935bf237a8743c',
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
