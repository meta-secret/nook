import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import type {
  AgentStatsAssembleRequest,
  AgentStatsFileRequest,
} from '../codec/args/agent-stats.ts';

import { AgentStatsOperation, RequestFamily } from '../codec/enums.ts';

import { AgentTemporaryDirectory } from '../lib/agent-temp-path.ts';

import { AgentStatisticsAssembly } from '../lib/agent-stats-assemble.ts';

import { AgentStatisticsSchema } from '../lib/agent-stats-schema.ts';

import { RepositoryRoot } from '../lib/repo.ts';

import { HostCommand } from '../lib/run.ts';

import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';

import type { RunCommandArgs } from '../lib/run.ts';

import type { ResolveAgentTempPathRequest } from '../lib/agent-temp-path.ts';

import type { ValidateAgentStatsYamlArgs } from '../lib/agent-stats-schema.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';

export class AgentStatisticsCommand {
  private constructor(private readonly request: AgentStatsAssembleRequest) {}

  static runAgentStatsAssemble(
    request: AgentStatsAssembleRequest,
  ): Promise<AgentStatsReport> {
    return new AgentStatisticsCommand(request).execute();
  }

  private async execute(): Promise<AgentStatsReport> {
    const request = this.request;
    const repoRoot = RepositoryRoot.find();
    const scratchPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.scratchPath,
    };
    const outputPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.outputPath,
    };
    const scratchPath =
      AgentTemporaryDirectory.resolveAgentTempPath(scratchPathRequest);
    const outPath =
      AgentTemporaryDirectory.resolveAgentTempPath(outputPathRequest);
    const assembledArgs = {
      repoRoot,
      prNumber: request.prNumber,
      scratchPath,
      includeInventory: request.includeTestInventory,
    };
    const assembled =
      await AgentStatisticsAssembly.assembleAgentStats(assembledArgs);

    const directoryOptions: { readonly recursive: true } = { recursive: true };
    mkdirSync(path.dirname(outPath), directoryOptions);
    writeFileSync(outPath, assembled.yaml, 'utf8');

    const validationArgs3: ValidateAgentStatsYamlArgs = {
      content: assembled.yaml,
      expectedPrNumber: request.prNumber,
    };
    const validation = AgentStatisticsSchema.validate(validationArgs3);
    if (!validation.ok) {
      const loomFailureDetailArgs4: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: `Assembled YAML failed validation:\n${validation.errors.join('\n')}`,
      };
      LoomFailure.detail(loomFailureDetailArgs4);
    }

    return {
      family: RequestFamily.AgentStats,
      operation: AgentStatsOperation.Assemble,
      outputPath: outPath,
      messages: [
        `wrote ${outPath}`,
        'schema validation passed',
        'fill comparison and waste_assessment in the scratch log before publish when placeholders remain',
      ],
    };
  }

  static async runAgentStatsValidate(
    request: AgentStatsFileRequest,
  ): Promise<AgentStatsReport> {
    const repoRoot = RepositoryRoot.find();
    const statsPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.statsFile,
    };
    const validateFileArgs: ValidateFileArgs = {
      operation: AgentStatsOperation.Validate,
      file: AgentTemporaryDirectory.resolveAgentTempPath(statsPathRequest),
    };
    return AgentStatisticsCommand.validateFile(validateFileArgs);
  }

  static async runAgentStatsPublish(
    request: AgentStatsFileRequest,
  ): Promise<AgentStatsReport> {
    const repoRoot = RepositoryRoot.find();
    const statsPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: request.statsFile,
    };
    const absolute =
      AgentTemporaryDirectory.resolveAgentTempPath(statsPathRequest);
    const prFromName = path.basename(absolute).replace(/\.ya?ml$/, '');
    const prNumber = Number.parseInt(prFromName, 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      LoomFailure.raise(LoomFailureCode.StatsFilenameInvalid);
    }

    const content = readFileSync(absolute, 'utf8');
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
      LoomFailure.detail(loomFailureDetailArgs3);
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
    const published = HostCommand.run(publishedArgs);
    if (published.exitCode !== 0) {
      const loomFailureDetailArgs2: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `workbench-publish failed: ${published.stderr || published.stdout}`,
      };
      LoomFailure.detail(loomFailureDetailArgs2);
    }

    return {
      family: RequestFamily.AgentStats,
      operation: AgentStatsOperation.Publish,
      outputPath: absolute,
      messages: [`published ${remotePath}`, (published.stdout || 'ok').trim()],
    };
  }

  private static validateFile(args: ValidateFileArgs): AgentStatsReport {
    const { operation, file } = args;

    const prFromName = path.basename(file).replace(/\.ya?ml$/, '');
    const prNumber = Number.parseInt(prFromName, 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      LoomFailure.raise(LoomFailureCode.StatsFilenameInvalid);
    }
    const content = readFileSync(file, 'utf8');
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
      LoomFailure.detail(loomFailureDetailArgs);
    }
    return {
      family: RequestFamily.AgentStats,
      operation,
      outputPath: path.resolve(file),
      messages: ['schema validation passed'],
    };
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
