import type { RepositoryDiscoveryFailure } from '../lib/repo.ts';
import type { ManifestFailure } from '../lib/dependency-popularity/scan.ts';
import type { RegistryFailure } from '../lib/dependency-popularity/registry-response.ts';
import {
  PullRequestValidationCommand,
  type PrLandFailure,
} from '../commands/pr-land.ts';
import type { SkillScaffoldFailure } from '../commands/skill-scaffold.ts';
import type { CortexSessionFailure } from '../commands/cortex-session-clean.ts';
import { err, ok, type Result } from 'neverthrow';
import type { CortexAuditFailure } from '../commands/cortex-audit.ts';
import { CORTEX_AUDIT_INPUT_SCHEMA } from '../codec/args/cortex-audit.ts';
import { CORTEX_SESSION_CLEAN_INPUT_SCHEMA } from '../codec/args/cortex-session-clean.ts';
import { DEPENDENCY_POPULARITY_INPUT_SCHEMA } from '../codec/args/dependency-popularity.ts';
import {
  PR_LAND_PR_INPUT_SCHEMA,
  PR_LAND_VALIDATE_INPUT_SCHEMA,
} from '../codec/args/pr-land.ts';
import { SKILL_SCAFFOLD_INPUT_SCHEMA } from '../codec/args/skill-scaffold.ts';
import { TOOLS_LIST_INPUT_SCHEMA } from '../codec/args/tools-list.ts';
import {
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
import {
  type SkillScaffoldReport,
  SkillScaffoldCommand,
} from '../commands/skill-scaffold.ts';
import { LoomFailureCode } from '../loom-failure.ts';
import { RepositoryRoot } from '../lib/repo.ts';

import type { LoomFailureDetailArgs } from '../loom-failure.ts';
export type DiscoverableRequest = {
  readonly family: RequestFamily;
  readonly operation?: PrLandOperation;
  readonly description: string;
  readonly exampleRequest: string;
  readonly exampleYaml: string;
  readonly inputSchema: ObjectJsonSchema;
};

export type LoomCommandResult =
  | CortexAuditReport
  | CortexSessionCleanReport
  | SkillScaffoldReport
  | PrLandReport
  | DependencyPopularityReport;

type RetiredRequestFailure = {
  readonly code: LoomFailureCode.CommandFailed;
  readonly message: string;
};

type DiscoverableRequestDefinition = Omit<
  DiscoverableRequest,
  'exampleYaml'
>;

/** Owns the loom request catalog registry and its capability transitions. */
export class LoomRequestCatalog {
  constructor(
    private readonly definitions: readonly DiscoverableRequestDefinition[] = DISCOVERABLE_DEFINITIONS,
  ) {}

  listDiscoverableRequests(): Result<
    readonly DiscoverableRequest[],
    RepositoryDiscoveryFailure
  > {
    const requests: DiscoverableRequest[] = [];
    for (const definition of this.definitions) {
      const encoded = new DiscoverableRequestExample(definition).yaml();
      if (encoded.isErr()) return err(encoded.error);
      const exampleYaml = encoded.value;
      requests.push({
        ...definition,
        exampleYaml,
      });
    }
    return ok(requests);
  }

  listAllRequestFamilies(): readonly RequestFamily[] {
    return LoomRequestSchema.listRequestFamilies();
  }
}

const DISCOVERABLE_DEFINITIONS: readonly DiscoverableRequestDefinition[] = [
  {
    family: RequestFamily.ToolsList,
    description: 'List Loom domain request kinds and schemas.',
    exampleRequest: 'task loom:tools-list',
    inputSchema: TOOLS_LIST_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.CortexAudit,
    description: 'Audit .cortex structure, links, and typed policy contracts.',
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
      'Dispatch remote build-only work and later manager-owned CI validation, then return hosted check evidence to the dev manager.',
    exampleRequest: 'task loom:pr-land CONFIG=<request.yaml>',
    inputSchema: PR_LAND_VALIDATE_INPUT_SCHEMA,
  },
  {
    family: RequestFamily.DependencyPopularity,
    description:
      'Reject low-popularity npm packages and crates.io crates against thresholds.',
    exampleRequest: 'task loom:dependency-popularity',
    inputSchema: DEPENDENCY_POPULARITY_INPUT_SCHEMA,
  },
];

export class LoomRequestExecution {
  constructor(private readonly request: LoomRequest) {}
  async execute(): Promise<
    Result<
      LoomCommandResult,
      | CortexAuditFailure
      | CortexSessionFailure
      | SkillScaffoldFailure
      | PrLandFailure
      | RetiredRequestFailure
      | RegistryFailure
      | ManifestFailure
    >
  > {
    const request = this.request;
    switch (request.family) {
      case RequestFamily.PrePush: {
        return err({
          code: LoomFailureCode.CommandFailed,
          message:
            'prePush is deprecated and does not execute; use remote build:compile and the manager-owned CI validation cycle',
        });
      }
      case RequestFamily.CortexAudit:
        return CortexAuditCommand.runCortexAudit(request.cortexAudit);
      case RequestFamily.CortexSessionClean: {
        const discovery4 = new RepositoryRoot().locate();
        if (discovery4.isErr()) return err(discovery4.error);
        return new CortexSessionDirectory({
          repoRoot: discovery4.value,
        }).clean();
      }
      case RequestFamily.SkillScaffold: {
        const discovery5 = new RepositoryRoot().locate();
        if (discovery5.isErr()) return err(discovery5.error);
        return new SkillScaffoldCommand({
          request: request.skillScaffold,
          repoRoot: discovery5.value,
        }).execute();
      }
      case RequestFamily.PrLand: {
        switch (request.operation) {
          case PrLandOperation.Status: {
            const discovery6 = new RepositoryRoot().locate();
            if (discovery6.isErr()) return err(discovery6.error);
            return new PullRequestDeliveryCommand({
              repoRoot: discovery6.value,
              prNumber: request.status.prNumber,
            }).status();
          }
          case PrLandOperation.Validate: {
            const discovery7 = new RepositoryRoot().locate();
            if (discovery7.isErr()) return err(discovery7.error);
            return new PullRequestValidationCommand({
              repoRoot: discovery7.value,
              request: request.validate,
            }).execute();
          }
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
        return err({
          code: loomFailureDetailArgs.code,
          message: loomFailureDetailArgs.text,
        });
      }
    }
  }
}
class DiscoverableRequestExample {
  constructor(private readonly definition: DiscoverableRequestDefinition) {}
  yaml(): Result<string, RepositoryDiscoveryFailure> {
    const definition = this.definition;
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
      return ok(LoomRequestExamples.exampleDocumentYaml(lookup.entry.document));
    }
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: `missing example catalog entry for ${definition.family}`,
    };
    return err({
      code: loomFailureDetailArgs.code,
      message: loomFailureDetailArgs.text,
    });
  }
}
