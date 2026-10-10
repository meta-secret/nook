import { err, ok, type Result } from 'neverthrow';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode } from '../loom-failure.ts';
import { CortexMarkdownInventory } from './cortex-markdown-files.ts';
import { CortexDocumentPath } from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';
import {
  type RepositoryCommandRequest,
  RepositoryCommand,
  RepositoryCommandExecutable,
} from './run.ts';

export type RunCortexValeArgs = {
  readonly cortexRoot: string;
  readonly repoRoot: string;
};

/** Owns the cortex vale invocation registry and its capability transitions. */
const REQUIRED_VALE_VERSION = 'vale version 3.22.0';
export class CortexValeInvocation {
  constructor(private readonly request: RunCortexValeArgs) {}
  execute(): Result<void, ValeFailure> {
    const args = this.request;
    if (!existsSync(args.cortexRoot)) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: `Cortex Markdown root does not exist: ${args.cortexRoot}`,
      });
    }
    const versionArgs: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Vale,
      args: ['--version'],
      rootDirectory: args.repoRoot,
      workingDirectory: args.repoRoot,
    };
    const versionLaunch = new RepositoryCommand(versionArgs).execute();
    if (versionLaunch.isErr()) return err(versionLaunch.error);
    const version = versionLaunch.value;
    if (
      version.exitCode !== 0 ||
      version.stdout.trim() !== REQUIRED_VALE_VERSION
    ) {
      return err({
        code: LoomFailureCode.CortexAuditFailed,
        message: 'Vale 3.22.0 is required for Cortex Markdown linting.',
      });
    }
    const selectedFiles =
      path.resolve(args.cortexRoot) === path.resolve(args.repoRoot, '.cortex')
        ? new CortexMarkdownInventory(args.repoRoot).repositoryFiles()
        : CortexMarkdownInventory.listPersistentCortexMarkdownFiles(
            args.cortexRoot,
          );
    const markdownFiles = selectedFiles.filter((filePath) => {
      const graphArgs: IsCanonicalKnowledgeGraphArgs = {
        cortexRoot: args.cortexRoot,
        filePath,
      };
      return (
        !path
          .relative(args.repoRoot, filePath)
          .split(path.sep)
          .includes('.session') &&
        new CortexKnowledgeGraphPath(graphArgs).role() ===
          CortexMarkdownRole.Article
      );
    });
    if (markdownFiles.length === 0) return ok();
    const lintArgs: RepositoryCommandRequest = {
      command: RepositoryCommandExecutable.Vale,
      args: [
        '--no-global',
        `--config=${path.join(args.repoRoot, '.vale.ini')}`,
        '--output=JSON',
        ...markdownFiles,
      ],
      rootDirectory: args.repoRoot,
      workingDirectory: args.repoRoot,
    };
    const lintLaunch = new RepositoryCommand(lintArgs).execute();
    if (lintLaunch.isErr()) return err(lintLaunch.error);
    const lint = lintLaunch.value;
    if (lint.exitCode === 0) return ok();
    return err({
      code: LoomFailureCode.CortexAuditFailed,
      message: `Vale Cortex lint failed:\n${lint.stdout || lint.stderr}`,
    });
  }
}
export class CortexKnowledgeGraphPath {
  constructor(private readonly request: IsCanonicalKnowledgeGraphArgs) {}
  role(): CortexMarkdownRole {
    const args = this.request;
    const relativePath = path
      .relative(args.cortexRoot, args.filePath)
      .split(path.sep)
      .join('/');
    switch (
      new CortexDocumentPath(
        path.relative(path.dirname(args.cortexRoot), args.filePath),
      ).isScopedGraphPath()
    ) {
      case true:
        return CortexMarkdownRole.KnowledgeGraph;
      case false:
        break;
    }
    if (relativePath === 'index.md') return CortexMarkdownRole.KnowledgeGraph;
    return /^(?:shared|teams\/(?:ai|dev-core|security|sre|web-dev))\/index\.md$/u.test(
      relativePath,
    )
      ? CortexMarkdownRole.KnowledgeGraph
      : CortexMarkdownRole.Article;
  }
}

export type IsCanonicalKnowledgeGraphArgs = {
  readonly cortexRoot: string;
  readonly filePath: string;
};

import type { ValeFailure } from './vale-files.ts';

export enum CortexMarkdownRole {
  KnowledgeGraph = 'knowledgeGraph',
  Article = 'article',
}
