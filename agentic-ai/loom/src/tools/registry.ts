import type { ManifestFailure } from '../lib/dependency-popularity/scan.ts';
import type { RegistryFailure } from '../lib/dependency-popularity/registry-response.ts';
import type { PrePushFailure } from '../commands/pre-push.ts';
import {
  PullRequestValidationCommand,
  type PrLandFailure,
} from '../commands/pr-land.ts';
import type { SkillScaffoldFailure } from '../commands/skill-scaffold.ts';
import type { CortexSessionFailure } from '../commands/cortex-session-clean.ts';
import { ok, type Result } from 'neverthrow';
import type { CortexAuditFailure } from '../commands/cortex-audit.ts';
import {
  AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
  AGENT_STATS_FILE_INPUT_SCHEMA,
} from '../codec/args/agent-stats.ts';
import { CORTEX_AUDIT_INPUT_SCHEMA } from '../codec/args/cortex-audit.ts';
import { CORTEX_SESSION_CLEAN_INPUT_SCHEMA } from '../codec/args/cortex-session-clean.ts';
import { DEPENDENCY_POPULARITY_INPUT_SCHEMA } from '../codec/args/dependency-popularity.ts';
import { PRE_PUSH_INPUT_SCHEMA } from '../codec/args/pre-push.ts';
import {
  PR_LAND_PR_INPUT_SCHEMA,
  PR_LAND_VALIDATE_INPUT_SCHEMA,
} from '../codec/args/pr-land.ts';
import { SKILL_SCAFFOLD_INPUT_SCHEMA } from '../codec/args/skill-scaffold.ts';
import { TOOLS_LIST_INPUT_SCHEMA } from '../codec/args/tools-list.ts';
import {
  AgentStatsOperation,
  PrLandOperation,
  RequestFamily,
} from '../codec/enums.ts';
import {
  ExampleCatalogPresence,
  ExampleOperationMarker,
  type FindExampleCatalogEntryArgs,
  LoomRequestExamples,
} from '../codec/example-documents.ts';
import type { ObjectJsonSchema } from '../codec/json-schema.ts';
import { type LoomRequest, LoomRequestSchema } from '../codec/request.ts';
import {
  type AgentStatsReport,
  AgentStatisticsCommand,
} from '../commands/agent-stats.ts';
import {
  type CortexAuditReport,
  CortexAuditCommand,
} from '../commands/cortex-audit.ts';
import {
  type CortexSessionCleanReport,
  CortexSessionDirectory,
} from '../commands/cortex-session-clean.ts';
import {
  type DependencyPopularityReport,
  DependencyPopularityCommand,
} from '../commands/dependency-popularity.ts';
import {
  type PrLandReport,
  PullRequestDeliveryCommand,
} from '../commands/pr-land.ts';
import { type PrePushReport, PrePushCommand } from '../commands/pre-push.ts';
import {
  type SkillScaffoldReport,
  SkillScaffoldCommand,
} from '../commands/skill-scaffold.ts';
import { LoomFailureCode, LoomFailure } from '../loom-failure.ts';
import {
  AGENT_TEMP_DIR_TOKEN,
  AgentTemporaryDirectory,
} from '../lib/agent-temp-path.ts';
import { RepositoryRoot, BunExecutable } from '../lib/repo.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
import type { ResolveAgentTempPathRequest } from '../lib/agent-temp-path.ts';
export type DiscoverableRequest = {
  readonly family: RequestFamily;
  readonly operation?: AgentStatsOperation | PrLandOperation;
  readonly description: string;
  readonly exampleRequest: string;
  readonly exampleYaml: string;
  readonly resolvedExampleYaml: string;
  readonly inputSchema: ObjectJsonSchema;
};

export type LoomCommandResult =
  | PrePushReport
  | CortexAuditReport
  | CortexSessionCleanReport
  | SkillScaffoldReport
  | AgentStatsReport
  | PrLandReport
  | DependencyPopularityReport;
type DiscoverableRequestDefinition = Omit<
  DiscoverableRequest,
  'exampleYaml' | 'resolvedExampleYaml'
>;

/** Owns the loom request catalog registry and its capability transitions. */
export class LoomRequestCatalog {
  private constructor() {}
  private static readonly DISCOVERABLE_DEFINITIONS: readonly DiscoverableRequestDefinition[] =
    [
      {
        family: RequestFamily.ToolsList,
        description: 'List Loom domain request kinds and schemas.',
        exampleRequest: 'task loom:tools-list',
        inputSchema: TOOLS_LIST_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.PrePush,
        description: 'Host-apply task format and enforce the UI demo contract.',
        exampleRequest: 'task loom:pre-push',
        inputSchema: PRE_PUSH_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.CortexAudit,
        description:
          'Audit .cortex structure, links, and typed policy contracts.',
        exampleRequest: 'task loom:cortex-audit',
        inputSchema: CORTEX_AUDIT_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.CortexSessionClean,
        description: 'Assert that temporary Cortex session memory is absent.',
        exampleRequest: 'task loom:cortex-session-clean',
        inputSchema: CORTEX_SESSION_CLEAN_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.SkillScaffold,
        description: 'Create a canonical team-owned Cortex dynamic-skill card.',
        exampleRequest: 'task loom:skill-scaffold CONFIG=<request.yaml>',
        inputSchema: SKILL_SCAFFOLD_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.AgentStats,
        operation: AgentStatsOperation.Assemble,
        description: 'Assemble AI-agent stats YAML for a PR.',
        exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
        inputSchema: AGENT_STATS_ASSEMBLE_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.AgentStats,
        operation: AgentStatsOperation.Validate,
        description: 'Validate an AI-agent stats YAML file.',
        exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
        inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.AgentStats,
        operation: AgentStatsOperation.Publish,
        description: 'Publish an AI-agent stats YAML file to Workbench.',
        exampleRequest: 'task loom:agent-stats CONFIG=<request.yaml>',
        inputSchema: AGENT_STATS_FILE_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.PrLand,
        operation: PrLandOperation.Status,
        description: 'Show PR status via gh.',
        exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
        inputSchema: PR_LAND_PR_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.PrLand,
        operation: PrLandOperation.Validate,
        description:
          'Run prePush and task pr:validate with final-head Codex review opted in, then require hosted checks and review collection before readiness.',
        exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
        inputSchema: PR_LAND_VALIDATE_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.PrLand,
        operation: PrLandOperation.Ready,
        description: 'Run task pr:ready for a PR.',
        exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
        inputSchema: PR_LAND_PR_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.PrLand,
        operation: PrLandOperation.MergeCheck,
        description: 'Summarize merge readiness without merging.',
        exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
        inputSchema: PR_LAND_PR_INPUT_SCHEMA,
      },
      {
        family: RequestFamily.DependencyPopularity,
        description:
          'Reject low-popularity npm packages and crates.io crates against thresholds.',
        exampleRequest: 'task loom:dependency-popularity',
        inputSchema: DEPENDENCY_POPULARITY_INPUT_SCHEMA,
      },
    ];

  static listDiscoverableRequests(): readonly DiscoverableRequest[] {
    const repoRoot = RepositoryRoot.find();
    const agentTempPathRequest: ResolveAgentTempPathRequest = {
      repoRoot,
      authoredPath: AGENT_TEMP_DIR_TOKEN,
    };
    const agentTempDirectory =
      AgentTemporaryDirectory.resolveAgentTempPath(agentTempPathRequest);

    return LoomRequestCatalog.DISCOVERABLE_DEFINITIONS.map((definition) => {
      const exampleYaml =
        LoomRequestCatalog.exampleYamlForDefinition(definition);
      if (!exampleYaml.includes(AGENT_TEMP_DIR_TOKEN)) {
        return { ...definition, exampleYaml, resolvedExampleYaml: exampleYaml };
      }
      return {
        ...definition,
        exampleYaml,
        resolvedExampleYaml: exampleYaml.replaceAll(
          AGENT_TEMP_DIR_TOKEN,
          agentTempDirectory,
        ),
      };
    });
  }

  private static exampleYamlForDefinition(
    definition: DiscoverableRequestDefinition,
  ): string {
    const operation = definition.operation;
    const findExampleCatalogEntryArgs: FindExampleCatalogEntryArgs =
      typeof operation === 'string'
        ? { family: definition.family, operation }
        : {
            family: definition.family,
            operation: ExampleOperationMarker.FamilyRoot,
          };
    const lookup = LoomRequestExamples.findExampleCatalogEntry(
      findExampleCatalogEntryArgs,
    );
    if (lookup.presence === ExampleCatalogPresence.Present) {
      return LoomRequestExamples.exampleDocumentYaml(lookup.entry.document);
    }
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: `missing example catalog entry for ${definition.family}`,
    };
    LoomFailure.detail(loomFailureDetailArgs);
  }

  static listAllRequestFamilies(): readonly RequestFamily[] {
    return LoomRequestSchema.listRequestFamilies();
  }

  static async executeRequest(
    request: LoomRequest,
  ): Promise<
    Result<
      LoomCommandResult,
      | CortexAuditFailure
      | CortexSessionFailure
      | SkillScaffoldFailure
      | PrLandFailure
      | PrePushFailure
      | RegistryFailure
      | ManifestFailure
    >
  > {
    switch (request.family) {
      case RequestFamily.PrePush: {
        BunExecutable.require();
        return new PrePushCommand({
          request: request.prePush,
          repoRoot: RepositoryRoot.find(),
        }).execute();
      }
      case RequestFamily.CortexAudit:
        return CortexAuditCommand.runCortexAudit(request.cortexAudit);
      case RequestFamily.CortexSessionClean:
        return new CortexSessionDirectory({
          repoRoot: RepositoryRoot.find(),
        }).clean();
      case RequestFamily.SkillScaffold:
        return new SkillScaffoldCommand({
          request: request.skillScaffold,
          repoRoot: RepositoryRoot.find(),
        }).execute();
      case RequestFamily.AgentStats: {
        switch (request.operation) {
          case AgentStatsOperation.Assemble:
            return ok(
              await AgentStatisticsCommand.runAgentStatsAssemble(
                request.assemble,
              ),
            );
          case AgentStatsOperation.Validate:
            return ok(
              await AgentStatisticsCommand.runAgentStatsValidate(
                request.validate,
              ),
            );
          case AgentStatsOperation.Publish:
            return ok(
              await AgentStatisticsCommand.runAgentStatsPublish(
                request.publish,
              ),
            );
        }
        break;
      }
      case RequestFamily.PrLand: {
        switch (request.operation) {
          case PrLandOperation.Status:
            return new PullRequestDeliveryCommand({
              repoRoot: RepositoryRoot.find(),
              prNumber: request.status.prNumber,
            }).status();
          case PrLandOperation.Validate:
            return new PullRequestValidationCommand({
              repoRoot: RepositoryRoot.find(),
              request: request.validate,
            }).execute();
          case PrLandOperation.Ready:
            return new PullRequestDeliveryCommand({
              repoRoot: RepositoryRoot.find(),
              prNumber: request.ready.prNumber,
            }).readiness();
          case PrLandOperation.MergeCheck:
            return new PullRequestDeliveryCommand({
              repoRoot: RepositoryRoot.find(),
              prNumber: request.mergeCheck.prNumber,
            }).mergeReadiness();
        }
        break;
      }
      case RequestFamily.DependencyPopularity:
        return new DependencyPopularityCommand(
          request.dependencyPopularity,
        ).execute();
      case RequestFamily.ToolsList:
      case RequestFamily.ToolsCall: {
        const loomFailureDetailArgs: LoomFailureDetailArgs = {
          code: LoomFailureCode.ValidationFailed,
          text: `${request.family} is handled by the dispatcher`,
        };
        LoomFailure.detail(loomFailureDetailArgs);
      }
    }
  }
}
