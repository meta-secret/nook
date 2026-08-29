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
};

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
    targetPath: false,
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
      (seam.specifier === specifier || seam.marker === specifier) &&
      seamDigestMatches(seam),
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
import { resolve } from 'node:path';
