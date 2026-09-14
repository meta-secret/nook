import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import {
  BranchName,
  CommitSha,
  DevFailureKind,
  LocalBuildEvidenceAuthorization,
  type DevFailure,
} from './dev-types.ts';
import { RepositoryCommand, RepositoryCommandExecutable } from '../lib/run.ts';

export const LOCAL_BUILD_EVIDENCE_SCHEMA_VERSION = 1 as const;
export enum LocalBuildEvidenceKind {
  Proof = 'nook-local-build-evidence',
}

export enum LocalBuildEvidenceGeneratorName {
  Generator = 'nook-local-build-evidence-generator',
}

export enum LocalBuildEvidenceStatus {
  Success = 'success',
}

export enum LocalBuildEvidenceArtifactIdentity {
  Success = 'nook-local-build-success-v1',
}

export const LOCAL_BUILD_EVIDENCE_AUTHORIZATION =
  LocalBuildEvidenceAuthorization.OneOffLocal;
export const LOCAL_BUILD_EVIDENCE_DEFAULT_LIFETIME_MS = 15 * 60 * 1000;
export const LOCAL_BUILD_EVIDENCE_MAX_LIFETIME_MS = 60 * 60 * 1000;
export const LOCAL_BUILD_EVIDENCE_MAX_BYTES = 256 * 1024;

export const LOCAL_BUILD_TASKS = ['build', 'rust:build'] as const;
export type LocalBuildTaskName = (typeof LOCAL_BUILD_TASKS)[number];

const localBuildTaskSchema = z.enum(LOCAL_BUILD_TASKS);
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
const localBuildEvidenceSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_BUILD_EVIDENCE_SCHEMA_VERSION),
    kind: z.literal(LocalBuildEvidenceKind.Proof),
    authorization: z.literal(LOCAL_BUILD_EVIDENCE_AUTHORIZATION),
    generator: z
      .object({
        name: z.literal(LocalBuildEvidenceGeneratorName.Generator),
        version: z.literal(1),
      })
      .strict(),
    source: z
      .object({
        branch: z.string().min(1),
        commit: shaSchema,
      })
      .strict(),
    task: z
      .object({
        id: z.string().regex(/^local-build-[A-Za-z0-9._:-]{2,116}$/u),
        attempt: z.number().int().positive().safe(),
        name: localBuildTaskSchema,
        result: z.literal(LocalBuildEvidenceStatus.Success),
        exitCode: z.literal(0),
        startedAt: timestampSchema,
        finishedAt: timestampSchema,
      })
      .strict(),
    command: z
      .object({
        executable: z.literal('task'),
        args: z.array(z.string()).length(1),
      })
      .strict(),
    tool: z
      .object({
        name: z.literal('task'),
        version: z.string().min(1).max(256),
      })
      .strict(),
    environment: z
      .object({
        platform: z.string().min(1).max(64),
        architecture: z.string().min(1).max(64),
        runtime: z.string().min(1).max(64),
      })
      .strict(),
    result: z
      .object({
        status: z.literal(LocalBuildEvidenceStatus.Success),
        exitCode: z.literal(0),
        outputDigest: digestSchema,
      })
      .strict(),
    artifact: z
      .object({
        identity: z.literal(LocalBuildEvidenceArtifactIdentity.Success),
        digest: digestSchema,
      })
      .strict(),
    expiresAt: timestampSchema,
  })
  .strict();

type LocalBuildEvidenceWire = z.infer<typeof localBuildEvidenceSchema>;
type CanonicalValue =
  | string
  | number
  | boolean
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export interface LocalBuildEvidence {
  readonly schemaVersion: typeof LOCAL_BUILD_EVIDENCE_SCHEMA_VERSION;
  readonly kind: LocalBuildEvidenceKind.Proof;
  readonly authorization: LocalBuildEvidenceAuthorization.OneOffLocal;
  readonly generator: {
    readonly name: LocalBuildEvidenceGeneratorName.Generator;
    readonly version: 1;
  };
  readonly source: {
    readonly branch: BranchName;
    readonly commit: CommitSha;
  };
  readonly task: {
    readonly id: string;
    readonly attempt: number;
    readonly name: LocalBuildTaskName;
    readonly result: LocalBuildEvidenceStatus.Success;
    readonly exitCode: 0;
    readonly startedAt: string;
    readonly finishedAt: string;
  };
  readonly command: {
    readonly executable: 'task';
    readonly args: readonly [LocalBuildTaskName];
  };
  readonly tool: {
    readonly name: 'task';
    readonly version: string;
  };
  readonly environment: {
    readonly platform: string;
    readonly architecture: string;
    readonly runtime: string;
  };
  readonly result: {
    readonly status: LocalBuildEvidenceStatus.Success;
    readonly exitCode: 0;
    readonly outputDigest: string;
  };
  readonly artifact: {
    readonly identity: LocalBuildEvidenceArtifactIdentity.Success;
    readonly digest: string;
  };
  readonly expiresAt: string;
}

export interface LocalBuildCommandRequest {
  readonly executable: 'task';
  readonly args: readonly [LocalBuildTaskName];
  readonly workingDirectory: string;
}

export interface LocalBuildCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalBuildCommandRunner {
  run(
    request: LocalBuildCommandRequest,
  ): Result<LocalBuildCommandOutput, DevFailure>;
  toolVersion(): Result<string, DevFailure>;
}

/** Owns the allowlisted host Task boundary used by the one-off proof generator. */
export class ProcessLocalBuildCommandRunner implements LocalBuildCommandRunner {
  constructor(private readonly workingDirectory: string) {}

  run(
    request: LocalBuildCommandRequest,
  ): Result<LocalBuildCommandOutput, DevFailure> {
    if (request.workingDirectory !== this.workingDirectory) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'Local build command working directory does not match the repository root',
      });
    }
    return this.runTask(request.args);
  }

  toolVersion(): Result<string, DevFailure> {
    const process = this.runTask(['--version']);
    if (process.isErr() || process.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Command,
        message: 'task --version did not complete successfully',
      });
    }
    const version = process.value.stdout.trim();
    if (
      !version ||
      version.length > 256 ||
      version.includes('\u0000') ||
      version.includes('\r') ||
      version.includes('\n')
    ) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'task --version returned an invalid tool identity',
      });
    }
    return ok(version);
  }

  private runTask(
    args: readonly string[],
  ): Result<LocalBuildCommandOutput, DevFailure> {
    try {
      const process = new RepositoryCommand({
        command: RepositoryCommandExecutable.Task,
        args: [...args],
        rootDirectory: this.workingDirectory,
        workingDirectory: this.workingDirectory,
      }).execute();
      if (process.isErr()) {
        return err({
          kind: DevFailureKind.Command,
          message: 'task command could not start',
        });
      }
      return ok({
        exitCode: process.value.exitCode,
        stdout: process.value.stdout,
        stderr: process.value.stderr,
      });
    } catch {
      return err({
        kind: DevFailureKind.Command,
        message: 'task command invocation failed',
      });
    }
  }
}

export interface LocalBuildEvidenceGenerationRequest {
  readonly repositoryRoot: string;
  readonly source: {
    readonly branch: BranchName;
    readonly commit: CommitSha;
  };
  readonly task: {
    readonly id: string;
    readonly attempt: number;
    readonly name: LocalBuildTaskName;
  };
  readonly outputPath: string;
}

/** Generates one strict, short-lived proof from the actual local Task result. */
export class LocalBuildEvidenceGenerator {
  private readonly clock: () => Date;
  private readonly environment: LocalBuildEvidence['environment'];

  constructor(
    private readonly request: {
      readonly runner: LocalBuildCommandRunner;
      readonly clock?: () => Date;
      readonly environment?: LocalBuildEvidence['environment'];
    },
  ) {
    this.clock = request.clock || (() => new Date());
    this.environment = request.environment || {
      platform: platform(),
      architecture: arch(),
      runtime: `bun-${Bun.version}`,
    };
  }

  execute(
    request: LocalBuildEvidenceGenerationRequest,
  ): Result<LocalBuildEvidence, DevFailure> {
    const input = this.validateInput(request);
    if (input.isErr()) return err(input.error);
    const toolVersion = this.request.runner.toolVersion();
    if (toolVersion.isErr()) return err(toolVersion.error);
    const startedAt = this.clock();
    const started = LocalBuildEvidenceGenerator.isoTime(startedAt);
    if (started.isErr()) return err(started.error);
    const output = this.request.runner.run({
      executable: 'task',
      args: [input.value.task.name],
      workingDirectory: input.value.repositoryRoot,
    });
    if (output.isErr()) return err(output.error);
    if (output.value.exitCode !== 0) {
      return err({
        kind: DevFailureKind.Evidence,
        message: `Local build task ${input.value.task.name} failed with exit code ${output.value.exitCode}; no proof was written`,
      });
    }
    const finishedAt = this.clock();
    const finished = LocalBuildEvidenceGenerator.isoTime(finishedAt);
    if (finished.isErr()) return err(finished.error);
    if (finishedAt.getTime() < startedAt.getTime()) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build clock moved backwards; no proof was written',
      });
    }
    const expiresAt = new Date(
      finishedAt.getTime() + LOCAL_BUILD_EVIDENCE_DEFAULT_LIFETIME_MS,
    );
    const expires = LocalBuildEvidenceGenerator.isoTime(expiresAt);
    if (expires.isErr()) return err(expires.error);
    const outputDigest = LocalBuildEvidenceGenerator.digest(
      `${output.value.stdout}\u0000${output.value.stderr}`,
    );
    const evidence = LocalBuildEvidenceGenerator.createEvidence({
      source: input.value.source,
      task: {
        ...input.value.task,
        result: LocalBuildEvidenceStatus.Success,
        exitCode: 0,
        startedAt: started.value,
        finishedAt: finished.value,
      },
      tool: { name: 'task', version: toolVersion.value },
      environment: this.environment,
      result: {
        status: LocalBuildEvidenceStatus.Success,
        exitCode: 0,
        outputDigest,
      },
      expiresAt: expires.value,
    });
    const persisted = new LocalBuildEvidenceStore().write({
      repositoryRoot: input.value.repositoryRoot,
      outputPath: input.value.outputPath,
      evidence,
    });
    if (persisted.isErr()) return err(persisted.error);
    return ok(evidence);
  }

  private validateInput(
    request: LocalBuildEvidenceGenerationRequest,
  ): Result<LocalBuildEvidenceGenerationRequest, DevFailure> {
    const taskId = request.task.id;
    if (
      !/^local-build-[A-Za-z0-9._:-]{2,116}$/u.test(taskId) ||
      !Number.isSafeInteger(request.task.attempt) ||
      request.task.attempt < 1
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message:
          'Local build evidence requires a bounded task identity and positive attempt',
      });
    }
    const outputPath = LocalBuildEvidenceStore.authorizedPath({
      repositoryRoot: request.repositoryRoot,
      outputPath: request.outputPath,
    });
    if (outputPath.isErr()) return err(outputPath.error);
    return ok({ ...request, outputPath: outputPath.value });
  }

  private static createEvidence(request: {
    readonly source: LocalBuildEvidenceGenerationRequest['source'];
    readonly task: LocalBuildEvidence['task'];
    readonly tool: LocalBuildEvidence['tool'];
    readonly environment: LocalBuildEvidence['environment'];
    readonly result: LocalBuildEvidence['result'];
    readonly expiresAt: string;
  }): LocalBuildEvidence {
    const artifactPayload = {
      schemaVersion: LOCAL_BUILD_EVIDENCE_SCHEMA_VERSION,
      kind: LocalBuildEvidenceKind.Proof,
      authorization: LOCAL_BUILD_EVIDENCE_AUTHORIZATION,
      generator: {
        name: LocalBuildEvidenceGeneratorName.Generator,
        version: 1 as const,
      },
      identity: LocalBuildEvidenceArtifactIdentity.Success,
      source: {
        branch: request.source.branch.value(),
        commit: request.source.commit.value(),
      },
      task: request.task,
      command: { executable: 'task' as const, args: [request.task.name] },
      tool: request.tool,
      environment: request.environment,
      result: request.result,
      expiresAt: request.expiresAt,
    };
    const artifact = {
      identity: artifactPayload.identity,
      digest: LocalBuildEvidenceGenerator.digest(
        LocalBuildEvidenceGenerator.canonical(artifactPayload),
      ),
    } as const;
    return {
      schemaVersion: LOCAL_BUILD_EVIDENCE_SCHEMA_VERSION,
      kind: LocalBuildEvidenceKind.Proof,
      authorization: LOCAL_BUILD_EVIDENCE_AUTHORIZATION,
      generator: {
        name: LocalBuildEvidenceGeneratorName.Generator,
        version: 1,
      },
      source: {
        branch: request.source.branch,
        commit: request.source.commit,
      },
      task: request.task,
      command: { executable: 'task', args: [request.task.name] },
      tool: request.tool,
      environment: request.environment,
      result: request.result,
      artifact,
      expiresAt: request.expiresAt,
    };
  }

  private static isoTime(value: Date): Result<string, DevFailure> {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build evidence requires finite timestamps',
      });
    }
    return ok(value.toISOString());
  }

  static digest(value: string): string {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
  }

  static canonical(value: CanonicalValue): string {
    if (LocalBuildEvidenceGenerator.isCanonicalArray(value))
      return `[${value.map((entry) => LocalBuildEvidenceGenerator.canonical(entry)).join(',')}]`;
    if (typeof value === 'object') {
      const object: { readonly [key: string]: CanonicalValue } = value;
      return `{${Object.entries(object)
        .sort()
        .map(
          ([key, entry]) =>
            `${JSON.stringify(key)}:${LocalBuildEvidenceGenerator.canonical(entry)}`,
        )
        .join(',')}}`;
    }
    const serialized = JSON.stringify(value);
    return serialized || 'null';
  }

  private static isCanonicalArray(
    value: CanonicalValue,
  ): value is readonly CanonicalValue[] {
    return Array.isArray(value);
  }
}

/** Owns the ignored local artifact location and atomic proof writes. */
export class LocalBuildEvidenceStore {
  static defaultPath(request: {
    readonly repositoryRoot: string;
    readonly sourceSha: CommitSha;
  }): string {
    return resolve(
      request.repositoryRoot,
      '.nook',
      'local-build-evidence',
      `${request.sourceSha.value()}.json`,
    );
  }

  static authorizedPath(request: {
    readonly repositoryRoot: string;
    readonly outputPath: string;
  }): Result<string, DevFailure> {
    if (
      !isAbsolute(request.repositoryRoot) ||
      !isAbsolute(request.outputPath)
    ) {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Local build evidence paths must be absolute',
      });
    }
    const root = resolve(request.repositoryRoot);
    const path = resolve(request.outputPath);
    try {
      const nookDirectory = resolve(root, '.nook');
      if (
        existsSync(nookDirectory) &&
        lstatSync(nookDirectory).isSymbolicLink()
      ) {
        return err({
          kind: DevFailureKind.Configuration,
          message:
            'Local build evidence cannot use a symbolic-link .nook directory',
        });
      }
      const expectedPrefix = resolve(root, '.nook', 'local-build-evidence');
      if (
        existsSync(expectedPrefix) &&
        lstatSync(expectedPrefix).isSymbolicLink()
      ) {
        return err({
          kind: DevFailureKind.Configuration,
          message:
            'Local build evidence cannot use a symbolic-link evidence directory',
        });
      }
      const pathRelativeToEvidence = relative(expectedPrefix, path);
      if (
        !pathRelativeToEvidence ||
        pathRelativeToEvidence.startsWith('..') ||
        isAbsolute(pathRelativeToEvidence) ||
        pathRelativeToEvidence.includes('/') ||
        !path.endsWith('.json')
      ) {
        return err({
          kind: DevFailureKind.Configuration,
          message:
            'Local build evidence must be a JSON file below .nook/local-build-evidence',
        });
      }
      return ok(path);
    } catch {
      return err({
        kind: DevFailureKind.Configuration,
        message: 'Local build evidence path could not be inspected safely',
      });
    }
  }

  write(request: {
    readonly repositoryRoot: string;
    readonly outputPath: string;
    readonly evidence: LocalBuildEvidence;
  }): Result<void, DevFailure> {
    const outputPath = LocalBuildEvidenceStore.authorizedPath(request);
    if (outputPath.isErr()) return err(outputPath.error);
    const evidenceDirectory = resolve(
      request.repositoryRoot,
      '.nook',
      'local-build-evidence',
    );
    try {
      LocalBuildEvidenceStore.requireDirectory(evidenceDirectory);
      if (
        existsSync(outputPath.value) &&
        lstatSync(outputPath.value).isSymbolicLink()
      ) {
        return err({
          kind: DevFailureKind.Configuration,
          message: 'Local build evidence output must not be a symbolic link',
        });
      }
      const wire = LocalBuildEvidenceStore.wire(request.evidence);
      const decoded = localBuildEvidenceSchema.safeParse(wire);
      if (!decoded.success) {
        return err({
          kind: DevFailureKind.Evidence,
          message: 'Local build evidence is malformed or incomplete',
        });
      }
      const verified = LocalBuildEvidenceStore.decode(decoded.data);
      if (verified.isErr()) return err(verified.error);
      const serialized = JSON.stringify(wire);
      const temporaryPath = `${outputPath.value}.tmp`;
      if (
        existsSync(temporaryPath) &&
        lstatSync(temporaryPath).isSymbolicLink()
      ) {
        return err({
          kind: DevFailureKind.Configuration,
          message:
            'Local build evidence temporary output must not be a symbolic link',
        });
      }
      writeFileSync(temporaryPath, `${serialized}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, outputPath.value);
      return ok();
    } catch {
      return err({
        kind: DevFailureKind.Command,
        message: 'Could not write local build evidence atomically',
      });
    }
  }

  private static requireDirectory(path: string): void {
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
        throw new Error('evidence directory is not a real directory');
      return;
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }

  private static wire(evidence: LocalBuildEvidence): LocalBuildEvidenceWire {
    return {
      schemaVersion: evidence.schemaVersion,
      kind: evidence.kind,
      authorization: evidence.authorization,
      generator: evidence.generator,
      source: {
        branch: evidence.source.branch.value(),
        commit: evidence.source.commit.value(),
      },
      task: evidence.task,
      command: {
        executable: evidence.command.executable,
        args: [...evidence.command.args],
      },
      tool: evidence.tool,
      environment: evidence.environment,
      result: evidence.result,
      artifact: evidence.artifact,
      expiresAt: evidence.expiresAt,
    };
  }

  read(request: {
    readonly repositoryRoot: string;
    readonly path: string;
  }): Result<LocalBuildEvidence, DevFailure> {
    const path = LocalBuildEvidenceStore.authorizedPath({
      repositoryRoot: request.repositoryRoot,
      outputPath: request.path,
    });
    if (path.isErr()) return err(path.error);
    try {
      const metadata = lstatSync(path.value);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        return err({
          kind: DevFailureKind.Evidence,
          message: 'Local build evidence must be a regular file',
        });
      }
      if (metadata.size > LOCAL_BUILD_EVIDENCE_MAX_BYTES) {
        return err({
          kind: DevFailureKind.Evidence,
          message: 'Local build evidence exceeds its size bound',
        });
      }
      const serialized = readFileSync(path.value, 'utf8');
      const decoded = localBuildEvidenceSchema.safeParse(
        JSON.parse(serialized),
      );
      if (!decoded.success) {
        return err({
          kind: DevFailureKind.Evidence,
          message: 'Local build evidence is malformed or incomplete',
        });
      }
      return LocalBuildEvidenceStore.decode(decoded.data);
    } catch {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build evidence could not be read',
      });
    }
  }

  private static decode(
    wire: LocalBuildEvidenceWire,
  ): Result<LocalBuildEvidence, DevFailure> {
    const branch = BranchName.parseFeature(wire.source.branch);
    if (branch.isErr()) return err(branch.error);
    const commit = CommitSha.parse(wire.source.commit);
    if (commit.isErr()) return err(commit.error);
    const startedAt = Date.parse(wire.task.startedAt);
    const finishedAt = Date.parse(wire.task.finishedAt);
    const expiresAt = Date.parse(wire.expiresAt);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(finishedAt) ||
      !Number.isFinite(expiresAt) ||
      finishedAt < startedAt ||
      expiresAt < finishedAt ||
      expiresAt === finishedAt ||
      expiresAt - finishedAt > LOCAL_BUILD_EVIDENCE_MAX_LIFETIME_MS
    ) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build evidence timestamps are invalid',
      });
    }
    if (wire.command.args[0] !== wire.task.name) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'Local build evidence command does not match its task identity',
      });
    }
    const artifactPayload = {
      schemaVersion: wire.schemaVersion,
      kind: wire.kind,
      authorization: wire.authorization,
      generator: wire.generator,
      identity: wire.artifact.identity,
      source: wire.source,
      task: wire.task,
      command: wire.command,
      tool: wire.tool,
      environment: wire.environment,
      result: wire.result,
      expiresAt: wire.expiresAt,
    };
    const expectedDigest = LocalBuildEvidenceGenerator.digest(
      LocalBuildEvidenceGenerator.canonical(artifactPayload),
    );
    if (wire.artifact.digest !== expectedDigest) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'Local build evidence artifact digest does not match its content',
      });
    }
    return ok({
      schemaVersion: wire.schemaVersion,
      kind: wire.kind,
      authorization: wire.authorization,
      generator: wire.generator,
      source: { branch: branch.value, commit: commit.value },
      task: wire.task,
      command: { executable: 'task', args: [wire.task.name] },
      tool: wire.tool,
      environment: wire.environment,
      result: wire.result,
      artifact: wire.artifact,
      expiresAt: wire.expiresAt,
    });
  }
}

/** Admits local proof only when it matches the currently observed branch head. */
export class LocalBuildEvidenceAdmission {
  constructor(
    private readonly request: {
      readonly repositoryRoot: string;
      readonly clock?: () => Date;
    },
  ) {}

  verify(request: {
    readonly path: string;
    readonly branch: BranchName;
    readonly commit: CommitSha;
  }): Result<LocalBuildEvidence, DevFailure> {
    const evidence = new LocalBuildEvidenceStore().read({
      repositoryRoot: this.request.repositoryRoot,
      path: request.path,
    });
    if (evidence.isErr()) return err(evidence.error);
    const now = (this.request.clock || (() => new Date()))().getTime();
    const startedAt = Date.parse(evidence.value.task.startedAt);
    const finishedAt = Date.parse(evidence.value.task.finishedAt);
    if (!Number.isFinite(now) || now < startedAt || now < finishedAt) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build evidence timestamp is from the future',
      });
    }
    const expiresAt = Date.parse(evidence.value.expiresAt);
    if (!Number.isFinite(now) || now >= expiresAt) {
      return err({
        kind: DevFailureKind.Evidence,
        message: 'Local build evidence is stale or expired',
      });
    }
    if (
      !evidence.value.source.branch.equals(request.branch) ||
      !evidence.value.source.commit.equals(request.commit)
    ) {
      return err({
        kind: DevFailureKind.Evidence,
        message:
          'Local build evidence does not match the observed feature branch head',
      });
    }
    return ok(evidence.value);
  }
}
