import { err, ok, type Result } from 'neverthrow';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from '../codec/args/agent-stats.ts';

import { AgentStatsOperation, RequestFamily } from '../codec/enums.ts';

import { AgentTemporaryPath } from '../lib/agent-temp-path.ts';

import { AgentStatisticsAssembly } from '../lib/agent-stats-assemble.ts';

import { AgentStatisticsSchema } from '../lib/agent-stats-schema.ts';

import { RepositoryRoot } from '../lib/repo.ts';

import { HostCommand } from '../lib/run.ts';

import { LoomFailureCode } from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';

import type { ResolveAgentTempPathRequest } from '../lib/agent-temp-path.ts';

import type { ValidateAgentStatsYamlArgs } from '../lib/agent-stats-schema.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class AgentStatisticsCommand {
  constructor(private readonly request: AgentStatsAssembleRequest) {}

  async execute(): Promise<Result<AgentStatsReport, AgentStatisticsFailure>> {
    const request = this.request;
    const discovery1 = new RepositoryRoot().locate();
    if (discovery1.isErr()) return err(discovery1.error);
    const repoRoot = discovery1.value;
    const scratchPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.scratchPath,
    };
    const outputPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.outputPath,
    };
    const temporaryPath1 = new AgentTemporaryPath(scratchPathRequest).resolve();
    if (temporaryPath1.isErr()) return err(temporaryPath1.error);
    const scratchPath = temporaryPath1.value;
    const temporaryPath2 = new AgentTemporaryPath(outputPathRequest).resolve();
    if (temporaryPath2.isErr()) return err(temporaryPath2.error);
    const outPath = temporaryPath2.value;
    const assembledArgs = {
      repoRoot,
      prNumber: request.prNumber,
      scratchPath,
      includeInventory: request.includeTestInventory,
    };
    const assembled = await new AgentStatisticsAssembly(
      assembledArgs,
    ).execute();
    if (assembled.isErr()) return err(assembled.error);

    const written = new AgentStatisticsDocument(outPath).write(
      assembled.value.yaml,
    );
    if (written.isErr()) return err(written.error);

    const validationArgs3: ValidateAgentStatsYamlArgs = {
      content: assembled.value.yaml,
      expectedPrNumber: request.prNumber,
    };
    const validation = AgentStatisticsSchema.validate(validationArgs3);
    if (!validation.ok) {
      const loomFailureDetailArgs4: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: `Assembled YAML failed validation:\n${validation.errors.join('\n')}`,
      };
      return err({
        code: loomFailureDetailArgs4.code,
        message: loomFailureDetailArgs4.text,
      });
    }

    return ok({
      family: RequestFamily.AgentStats,
      operation: AgentStatsOperation.Assemble,
      outputPath: outPath,
      messages: [
        `wrote ${outPath}`,
        'schema validation passed',
        'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
      ],
    });
  }
}

export class AgentStatisticsFileCommand {
  constructor(private readonly request: AgentStatsFileRequest) {}

  async validate(): Promise<Result<AgentStatsReport, AgentStatisticsFailure>> {
    const request = this.request;
    const discovery2 = new RepositoryRoot().locate();
    if (discovery2.isErr()) return err(discovery2.error);
    const repoRoot = discovery2.value;
    const statsPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.statsFile,
    };
    const temporaryPath3 = new AgentTemporaryPath(statsPathRequest).resolve();
    if (temporaryPath3.isErr()) return err(temporaryPath3.error);
    const validateFileArgs: ValidateFileArgs = {
      operation: AgentStatsOperation.Validate,
      file: temporaryPath3.value,
    };
    return this.validateFile(validateFileArgs);
  }

  async publish(): Promise<Result<AgentStatsReport, AgentStatisticsFailure>> {
    const request = this.request;
    const discovery3 = new RepositoryRoot().locate();
    if (discovery3.isErr()) return err(discovery3.error);
    const repoRoot = discovery3.value;
    const statsPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.statsFile,
    };
    const temporaryPath4 = new AgentTemporaryPath(statsPathRequest).resolve();
    if (temporaryPath4.isErr()) return err(temporaryPath4.error);
    const absolute = temporaryPath4.value;
    const prFromName = path.basename(absolute).replace(/\.ya?ml$/, '');
    const prNumber = Number.parseInt(prFromName, 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return err({
        code: LoomFailureCode.StatsFilenameInvalid,
        message: 'Stats filename must be <pr-number>.yaml',
      });
    }

    const read = new AgentStatisticsDocument(absolute).read();
    if (read.isErr()) return err(read.error);
    const content = read.value;
    const validationArgs2: ValidateAgentStatsYamlArgs = {
      content,
      expectedPrNumber: prNumber,
    };
    const validation = AgentStatisticsSchema.validate(validationArgs2);
    if (!validation.ok) {
      const loomFailureDetailArgs3: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: validation.errors.join('\n'),
      };
      return err({
        code: loomFailureDetailArgs3.code,
        message: loomFailureDetailArgs3.text,
      });
    }

    const remotePath = `stats/ai-agent/${prNumber}.yaml`;
    const publishedArgs: RunCommandArgs = {
      command: 'node',
      args: [
        '.github/scripts/workbench-publish.cjs',
        absolute,
        remotePath,
        `stats: record Nook PR ${prNumber}`,
      ],
      cwd: repoRoot,
    };
    const publishedLaunch = new HostCommand(publishedArgs).execute();
    if (publishedLaunch.isErr()) return err(publishedLaunch.error);
    const published = publishedLaunch.value;
    if (published.exitCode !== 0) {
      const loomFailureDetailArgs2: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `workbench-publish failed: ${published.stderr || published.stdout}`,
      };
      return err({
        code: loomFailureDetailArgs2.code,
        message: loomFailureDetailArgs2.text,
      });
    }

    return ok({
      family: RequestFamily.AgentStats,
      operation: AgentStatsOperation.Publish,
      outputPath: absolute,
      messages: [`published ${remotePath}`, (published.stdout || 'ok').trim()],
    });
  }

  private validateFile(
    args: ValidateFileArgs,
  ): Result<AgentStatsReport, AgentStatisticsFailure> {
    const { operation, file } = args;

    const prFromName = path.basename(file).replace(/\.ya?ml$/, '');
    const prNumber = Number.parseInt(prFromName, 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return err({
        code: LoomFailureCode.StatsFilenameInvalid,
        message: 'Stats filename must be <pr-number>.yaml',
      });
    }
    const read = new AgentStatisticsDocument(file).read();
    if (read.isErr()) return err(read.error);
    const content = read.value;
    const validationArgs: ValidateAgentStatsYamlArgs = {
      content,
      expectedPrNumber: prNumber,
    };
    const validation = AgentStatisticsSchema.validate(validationArgs);
    if (!validation.ok) {
      const loomFailureDetailArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: validation.errors.join('\n'),
      };
      return err({
        code: loomFailureDetailArgs.code,
        message: loomFailureDetailArgs.text,
      });
    }
    return ok({
      family: RequestFamily.AgentStats,
      operation,
      outputPath: path.resolve(file),
      messages: ['schema validation passed'],
    });
  }
}

export type AgentStatsReport = {
  readonly family: RequestFamily.AgentStats;
  readonly operation: AgentStatsOperation;
  readonly messages: string[];
  readonly outputPath: string;
};

type ValidateFileArgs = {
  readonly operation: AgentStatsOperation.Validate;
  readonly file: string;
};

export type AgentStatisticsFailure = {
  readonly code: LoomFailureCode;
  readonly message: string;
};
class AgentStatisticsDocument {
  constructor(private readonly file: string) {}
  read(): Result<string, AgentStatisticsFailure> {
    try {
      return ok(readFileSync(this.file, 'utf8'));
    } catch {
      return err({
        code: LoomFailureCode.FileReadFailed,
        message: `Could not read statistics file: ${this.file}`,
      });
    }
  }
  write(content: string): Result<void, AgentStatisticsFailure> {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, content, 'utf8');
      return ok();
    } catch {
      return err({
        code: LoomFailureCode.CommandFailed,
        message: `Could not write statistics file: ${this.file}`,
      });
    }
  }
}
