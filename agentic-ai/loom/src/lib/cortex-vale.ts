import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  loomFailureDetail,
  type LoomFailureDetailArgs,
} from '../loom-failure.ts';
import { listPersistentCortexMarkdownFiles } from './cortex-markdown-files.ts';
import { runCommand, type RunCommandArgs } from './run.ts';

export type RunCortexValeArgs = {
  readonly cortexRoot: string;
  readonly repoRoot: string;
};

const REQUIRED_VALE_VERSION = 'vale version 3.19.0';

export function runCortexVale(args: RunCortexValeArgs): void {
  if (!existsSync(args.cortexRoot)) {
    fail(`Cortex Markdown root does not exist: ${args.cortexRoot}`);
  }
  const versionArgs: RunCommandArgs = {
    command: 'vale',
    args: ['--version'],
    cwd: args.repoRoot,
  };
  const version = runCommand(versionArgs);
  if (
    version.exitCode !== 0 ||
    version.stdout.trim() !== REQUIRED_VALE_VERSION
  ) {
    fail('Vale 3.19.0 is required for Cortex Markdown linting.');
  }
  const markdownFiles = listPersistentCortexMarkdownFiles(
    args.cortexRoot,
  ).filter((filePath) => {
    const graphArgs: IsCanonicalKnowledgeGraphArgs = {
      cortexRoot: args.cortexRoot,
      filePath,
    };
    return !isCanonicalKnowledgeGraph(graphArgs);
  });
  if (markdownFiles.length === 0) return;
  const lintArgs: RunCommandArgs = {
    command: 'vale',
    args: [
      '--no-global',
      `--config=${path.join(args.repoRoot, '.vale.ini')}`,
      '--output=JSON',
      ...markdownFiles,
    ],
    cwd: args.repoRoot,
  };
  const lint = runCommand(lintArgs);
  if (lint.exitCode === 0) return;
  fail(`Vale Cortex lint failed:\n${lint.stdout || lint.stderr}`);
}

export type IsCanonicalKnowledgeGraphArgs = {
  readonly cortexRoot: string;
  readonly filePath: string;
};

export function isCanonicalKnowledgeGraph(
  args: IsCanonicalKnowledgeGraphArgs,
): boolean {
  const relativePath = path
    .relative(args.cortexRoot, args.filePath)
    .split(path.sep)
    .join('/');
  if (
    relativePath === 'knowledge-graph.md' ||
    relativePath === 'k-graph.md' ||
    relativePath === 'INDEX.md'
  ) {
    return true;
  }
  return /^(?:gizmo|shared|teams\/(?:ai|dev-core|security|sre|web-dev))\/knowledge-graph\.md$/u.test(
    relativePath,
  );
}

function fail(text: string): never {
  const detailArgs: LoomFailureDetailArgs = {
    code: LoomFailureCode.CortexAuditFailed,
    text,
  };
  return loomFailureDetail(detailArgs);
}
