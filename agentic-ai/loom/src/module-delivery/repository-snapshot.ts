import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { ModuleRepositoryGit } from './git-command.ts';
import { FilesystemPathPresence } from './workspace-paths.ts';

import type { GitCommandRequest } from './git-command.ts';
import type {
  SourceRepositorySnapshot,
  SourceSnapshotExpectation,
} from './integration-provenance-registry.ts';

type ModuleGitInvocation = {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly allowFailure?: boolean;
};

type RepositoryPathSet = {
  readonly repositoryRoot: string;
  readonly paths: readonly string[];
  readonly includeContent: boolean;
};

type RepositoryFingerprint = {
  readonly contentDigest: string;
  readonly metadataDigest: string;
};

type EntryFingerprint = {
  readonly content: readonly Buffer[];
  readonly metadata: readonly Buffer[];
};

type SymlinkAncestorInspection = {
  readonly root: string;
  readonly absolutePath: string;
};

type EntryFingerprintRequest = {
  readonly repositoryRoot: string;
  readonly path: string;
  readonly includeContent: boolean;
};

type RepositorySnapshotRequest = {
  readonly repositoryRoot: string;
  readonly includeContent: boolean;
};

const BIGINT_STATS_OPTIONS = { bigint: true } as const;

export class ModuleDeliverySourceRepositorySnapshot {
  private constructor() {}

  private static gitRequest(
    invocation: ModuleGitInvocation,
  ): GitCommandRequest {
    if ('allowFailure' in invocation) {
      return {
        cwd: invocation.cwd,
        args: invocation.args,
        allowFailure: invocation.allowFailure,
      };
    }
    return { cwd: invocation.cwd, args: invocation.args };
  }

  private static gitBytes(invocation: ModuleGitInvocation): Buffer {
    return ModuleRepositoryGit.runModuleDeliveryGit(
      ModuleDeliverySourceRepositorySnapshot.gitRequest(invocation),
    ).stdout;
  }

  private static digestBuffers(buffers: readonly Buffer[]): string {
    const hash = createHash('sha256');
    for (const bytes of buffers) {
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(length);
      hash.update(bytes);
    }
    return hash.digest('hex');
  }

  private static nullSeparatedPaths(bytes: Buffer): readonly string[] {
    if (bytes.length === 0) return [];
    if (bytes.at(-1) !== 0) {
      throw new Error('Repository path list requires NUL termination.');
    }
    const paths: string[] = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0) continue;
      const encoded = bytes.subarray(start, index);
      const path = encoded.toString('utf8');
      if (!Buffer.from(path, 'utf8').equals(encoded)) {
        throw new Error('Repository path is not valid UTF-8.');
      }
      paths.push(path);
      start = index + 1;
    }
    return paths;
  }

  private static assertNoSymlinkAncestor(
    inspection: SymlinkAncestorInspection,
  ): void {
    let parent = dirname(inspection.absolutePath);
    while (parent !== inspection.root) {
      if (lstatSync(parent).isSymbolicLink()) {
        throw new Error('Repository entry has a symlink ancestor.');
      }
      parent = dirname(parent);
    }
  }

  private static entryFingerprint(
    request: EntryFingerprintRequest,
  ): EntryFingerprint {
    const absolutePath = resolve(request.repositoryRoot, request.path);
    const fromRoot = relative(request.repositoryRoot, absolutePath);
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new Error('Repository entry escapes its root.');
    }
    const ancestorInspection: SymlinkAncestorInspection = {
      root: request.repositoryRoot,
      absolutePath,
    };
    ModuleDeliverySourceRepositorySnapshot.assertNoSymlinkAncestor(
      ancestorInspection,
    );
    const pathTag = Buffer.from(`path:${request.path}`, 'utf8');
    if (!FilesystemPathPresence.exists(absolutePath)) {
      return {
        content: [pathTag, Buffer.from('content:missing', 'utf8')],
        metadata: [pathTag, Buffer.from('kind:missing', 'utf8')],
      };
    }
    const metadata = lstatSync(absolutePath, BIGINT_STATS_OPTIONS);
    const kind = metadata.isSymbolicLink()
      ? 'symlink'
      : metadata.isFile()
        ? 'file'
        : metadata.isDirectory()
          ? 'directory'
          : 'other';
    const metadataTag = Buffer.from(
      [
        `kind:${kind}`,
        `mode:${metadata.mode.toString(8)}`,
        `dev:${metadata.dev.toString()}`,
        `ino:${metadata.ino.toString()}`,
        `size:${metadata.size.toString()}`,
        `mtime:${metadata.mtimeNs.toString()}`,
        `ctime:${metadata.ctimeNs.toString()}`,
      ].join('|'),
      'utf8',
    );
    if (kind === 'symlink') {
      return {
        content: request.includeContent
          ? [
              pathTag,
              Buffer.from('content:symlink-target', 'utf8'),
              Buffer.from(readlinkSync(absolutePath), 'utf8'),
            ]
          : [],
        metadata: [pathTag, metadataTag],
      };
    }
    if (kind === 'file') {
      return {
        content: request.includeContent
          ? [
              pathTag,
              Buffer.from('content:file-bytes', 'utf8'),
              readFileSync(absolutePath),
            ]
          : [],
        metadata: [pathTag, metadataTag],
      };
    }
    return {
      content: [pathTag, Buffer.from(`content:${kind}`, 'utf8')],
      metadata: [pathTag, metadataTag],
    };
  }

  private static repositoryFingerprint(
    paths: RepositoryPathSet,
  ): RepositoryFingerprint {
    const content: Buffer[] = [];
    const metadata: Buffer[] = [];
    for (const path of [...paths.paths].sort()) {
      const request: EntryFingerprintRequest = {
        repositoryRoot: paths.repositoryRoot,
        path,
        includeContent: paths.includeContent,
      };
      const fingerprint =
        ModuleDeliverySourceRepositorySnapshot.entryFingerprint(request);
      content.push(...fingerprint.content);
      metadata.push(...fingerprint.metadata);
    }
    return {
      contentDigest: ModuleDeliverySourceRepositorySnapshot.digestBuffers(content),
      metadataDigest:
        ModuleDeliverySourceRepositorySnapshot.digestBuffers(metadata),
    };
  }

  private static repositoryPaths(repositoryRoot: string): readonly string[] {
    const trackedInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['ls-files', '-z'],
    };
    const untrackedInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['ls-files', '--others', '--exclude-standard', '-z'],
    };
    return [
      ...new Set([
        ...ModuleDeliverySourceRepositorySnapshot.nullSeparatedPaths(
          ModuleDeliverySourceRepositorySnapshot.gitBytes(trackedInvocation),
        ),
        ...ModuleDeliverySourceRepositorySnapshot.nullSeparatedPaths(
          ModuleDeliverySourceRepositorySnapshot.gitBytes(untrackedInvocation),
        ),
      ]),
    ];
  }

  private static relevantRefsDigest(repositoryRoot: string): string {
    const invocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: [
        'for-each-ref',
        '--sort=refname',
        '--format=%(refname)%00%(objectname)%00%(symref)',
        'refs',
      ],
    };
    const fields: Buffer[] = [];
    for (const record of ModuleDeliverySourceRepositorySnapshot.gitBytes(
      invocation,
    )
      .toString('utf8')
      .split('\n')) {
      if (record.length === 0) continue;
      const [ref = '', objectId = '', symref = ''] = record.split('\0');
      if (/^refs\/nook\/module-delivery\//u.test(ref)) continue;
      if (ref.length === 0 || objectId.length === 0)
        throw new Error('Repository ref fingerprint record is malformed.');
      fields.push(
        Buffer.from(ref, 'utf8'),
        Buffer.from(objectId, 'ascii'),
        Buffer.from(symref, 'utf8'),
      );
    }
    return ModuleDeliverySourceRepositorySnapshot.digestBuffers(fields);
  }

  private static captureRepositorySnapshot(
    request: RepositorySnapshotRequest,
  ): SourceRepositorySnapshot {
    const repositoryRoot = request.repositoryRoot;
    const headInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    };
    const branchInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['symbolic-ref', '--quiet', 'HEAD'],
      allowFailure: true,
    };
    const branch = ModuleRepositoryGit.runModuleDeliveryGit(
      ModuleDeliverySourceRepositorySnapshot.gitRequest(branchInvocation),
    );
    const indexPathInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
    };
    const configInvocation: ModuleGitInvocation = {
      cwd: repositoryRoot,
      args: ['config', '--local', '--null', '--list'],
    };
    const pathSet: RepositoryPathSet = {
      repositoryRoot,
      paths:
        ModuleDeliverySourceRepositorySnapshot.repositoryPaths(repositoryRoot),
      includeContent: request.includeContent,
    };
    const fingerprint =
      ModuleDeliverySourceRepositorySnapshot.repositoryFingerprint(pathSet);
    const indexPath = ModuleRepositoryGit.gitText(
      ModuleRepositoryGit.runModuleDeliveryGit(
        ModuleDeliverySourceRepositorySnapshot.gitRequest(indexPathInvocation),
      ),
    );
    return {
      headCommit: ModuleRepositoryGit.gitText(
        ModuleRepositoryGit.runModuleDeliveryGit(
          ModuleDeliverySourceRepositorySnapshot.gitRequest(headInvocation),
        ),
      ),
      symbolicHead:
        branch.exitCode === 0
          ? ModuleRepositoryGit.gitText(branch)
          : '(detached)',
      contentDigest: fingerprint.contentDigest,
      metadataDigest: fingerprint.metadataDigest,
      indexDigest: ModuleDeliverySourceRepositorySnapshot.digestBuffers([
        readFileSync(indexPath),
      ]),
      refsDigest:
        ModuleDeliverySourceRepositorySnapshot.relevantRefsDigest(repositoryRoot),
      configDigest: ModuleDeliverySourceRepositorySnapshot.digestBuffers([
        ModuleDeliverySourceRepositorySnapshot.gitBytes(configInvocation),
      ]),
    };
  }

  static captureSourceSnapshot(
    repositoryRoot: string,
  ): SourceRepositorySnapshot {
    const request: RepositorySnapshotRequest = {
      repositoryRoot,
      includeContent: true,
    };
    return ModuleDeliverySourceRepositorySnapshot.captureRepositorySnapshot(
      request,
    );
  }

  static assertSourceSnapshot(expectation: SourceSnapshotExpectation): void {
    const request: RepositorySnapshotRequest = {
      repositoryRoot: expectation.repositoryRoot,
      includeContent: true,
    };
    const current =
      ModuleDeliverySourceRepositorySnapshot.captureRepositorySnapshot(request);
    if (
      current.headCommit !== expectation.expected.headCommit ||
      current.symbolicHead !== expectation.expected.symbolicHead ||
      current.contentDigest !== expectation.expected.contentDigest ||
      current.metadataDigest !== expectation.expected.metadataDigest ||
      current.indexDigest !== expectation.expected.indexDigest ||
      current.refsDigest !== expectation.expected.refsDigest ||
      current.configDigest !== expectation.expected.configDigest
    ) {
      throw new Error(
        'Source repository changed after integration preparation.',
      );
    }
  }


}
