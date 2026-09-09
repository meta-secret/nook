import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  LoomFailureCode,
  type LoomFailureDetailArgs,
  LoomFailure,
} from '../loom-failure.ts';
import { CortexMarkdownInventory } from './cortex-markdown-files.ts';
import { type RunCommandArgs, HostCommand } from './run.ts';

export type RunCortexValeArgs = {
  readonly cortexRoot: string;
  readonly repoRoot: string;
};

/** Owns the cortex vale invocation registry and its capability transitions. */
export class CortexValeInvocation {
  private constructor() {}
  private static readonly REQUIRED_VALE_VERSION = 'vale version 3.19.0';

  static runCortexVale(args: RunCortexValeArgs): void {
    if (!existsSync(args.cortexRoot)) {
      CortexValeInvocation.fail(
        `Cortex Markdown root does not exist: ${args.cortexRoot}`,
      );
    }
    const versionArgs: RunCommandArgs = {
      command: 'vale',
      args: ['--version'],
      cwd: args.repoRoot,
    };
    const version = HostCommand.run(versionArgs);
    if (
      version.exitCode !== 0 ||
      version.stdout.trim() !== CortexValeInvocation.REQUIRED_VALE_VERSION
    ) {
      CortexValeInvocation.fail(
        'Vale 3.19.0 is required for Cortex Markdown linting.',
      );
    }
    const markdownFiles =
      CortexMarkdownInventory.listPersistentCortexMarkdownFiles(
        args.cortexRoot,
      ).filter((filePath) => {
        const graphArgs: IsCanonicalKnowledgeGraphArgs = {
          cortexRoot: args.cortexRoot,
          filePath,
        };
        return !CortexValeInvocation.isCanonicalKnowledgeGraph(graphArgs);
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
    const lint = HostCommand.run(lintArgs);
    if (lint.exitCode === 0) return;
    CortexValeInvocation.fail(
      `Vale Cortex lint failed:\n${lint.stdout || lint.stderr}`,
    );
  }

  static isCanonicalKnowledgeGraph(
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

  private static fail(text: string): never {
    const detailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.CortexAuditFailed,
      text,
    };
    return LoomFailure.detail(detailArgs);
  }
}

export type IsCanonicalKnowledgeGraphArgs = {
  readonly cortexRoot: string;
  readonly filePath: string;
};
