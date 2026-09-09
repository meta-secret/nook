import { expect, test } from 'bun:test';

import { CortexConsistencyContract } from '../src/audit.ts';

import {
  CortexCompatibilityEvidence,
  CortexContractFindingCode,
  CortexContextAuthorityDocument,
  CortexPolicyArea,
  CortexPolicyCapability,
  CortexPolicyContractKind,
  type AuditCortexContractsArgs,
} from '../src/domain.ts';

export class CortexConsistencyAuditScenario {
  private constructor(private readonly request: readonly string[]) {}

  static adversarialAuthority(value: string): CortexContextAuthorityDocument {
    return value as CortexContextAuthorityDocument;
  }

  static request(references: readonly string[]): AuditCortexContractsArgs {
    return new CortexConsistencyAuditScenario(references).execute();
  }

  private execute(): AuditCortexContractsArgs {
    const references = this.request;
    return {
      registry: {
        contexts: [
          {
            authorityDocument: AUTHORITY,
            ownsAreas: [CortexPolicyArea.GithubTypescript],
            imports: [POLICY],
          },
        ],
        policies: [
          {
            document: POLICY,
            kind: CortexPolicyContractKind.General,
            areas: [CortexPolicyArea.GithubTypescript],
            capabilities: [],
          },
        ],
        runtimes: [],
      },
      documents: [
        { relativePath: AUTHORITY, references, commands: [] },
        { relativePath: POLICY, references: [], commands: [] },
      ],
    };
  }

  static persistedRequest(
    args: PersistedRequestArgs,
  ): AuditCortexContractsArgs {
    const { references = [] } = args;
    return {
      registry: {
        contexts: [],
        policies: [
          {
            document: RUST_POLICY,
            kind: CortexPolicyContractKind.PersistedRepresentation,
            schemaAuthority: args.schemaAuthority,
            evidence: args.evidence,
            areas: [],
            capabilities: [],
          },
          {
            document: SCHEMA_POLICY,
            kind: CortexPolicyContractKind.General,
            areas: [],
            capabilities: [CortexPolicyCapability.SchemaVersioning],
          },
        ],
        runtimes: [],
      },
      documents: [
        {
          relativePath: RUST_POLICY,
          references,
          commands: [],
        },
        { relativePath: SCHEMA_POLICY, references: [], commands: [] },
      ],
    };
  }
}

const AUTHORITY = CortexContextAuthorityDocument.Sre;

const POLICY =
  '.cortex/teams/web-dev/dynamic-skills/typescript-enums-over-booleans.md';

const RUST_POLICY = '.cortex/teams/dev-core/dynamic-skills/rust-coding.md';

const SCHEMA_POLICY =
  '.cortex/teams/dev-core/design-docs/vault-schema-versioning.md';

test('accepts a referenced imported policy', () => {
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.request([
        '../web-dev/dynamic-skills/typescript-enums-over-booleans.md',
      ]),
    ).execute(),
  ).toEqual([]);
});

test('rejects missing and retired native delegation runtime bindings', () => {
  const workflow = '.cortex/gizmo/workflows/subagent-delegation.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [],
      policies: [],
      runtimes: [
        {
          document: workflow,
          allowedCommandPrefixes: ['task skills:run'],
          requiredCommandPrefixes: ['task skills:run'],
          retiredCommandPrefixes: ['loom-agent-delegation'],
        },
      ],
    },
    documents: [
      {
        relativePath: workflow,
        references: [],
        commands: [
          'loom-agent-delegation start --plan plan.json',
          'delegationVisualization.render',
          'task missing:runtime',
        ],
      },
    ],
  };
  expect(CortexConsistencyContract.from(compileRequest).execute()).toEqual([
    expect.objectContaining({
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: workflow,
      message:
        'Cortex workflow names an unregistered runtime entrypoint: task missing:runtime',
    }),
    expect.objectContaining({
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: workflow,
    }),
    expect.objectContaining({
      code: CortexContractFindingCode.RetiredRuntimeEntrypoint,
      file: workflow,
    }),
  ]);
});

test('accepts the static skill host for native delegation rendering', () => {
  const workflow = '.cortex/gizmo/workflows/subagent-delegation.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [],
      policies: [],
      runtimes: [
        {
          document: workflow,
          allowedCommandPrefixes: ['task skills:run'],
          requiredCommandPrefixes: ['task skills:run'],
          retiredCommandPrefixes: ['loom-agent-delegation'],
        },
      ],
    },
    documents: [
      {
        relativePath: workflow,
        references: [],
        commands: ['task skills:run REQUEST_YAML=strict-yaml'],
      },
    ],
  };
  expect(CortexConsistencyContract.from(compileRequest).execute()).toEqual([]);
});

test('rejects a missing registered runtime document', () => {
  const workflow = '.cortex/gizmo/workflows/subagent-delegation.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [],
      policies: [],
      runtimes: [
        {
          document: workflow,
          allowedCommandPrefixes: ['task skills:run'],
          requiredCommandPrefixes: ['task skills:run'],
          retiredCommandPrefixes: [],
        },
      ],
    },
    documents: [],
  };
  expect(CortexConsistencyContract.from(compileRequest).execute()).toEqual([
    expect.objectContaining({
      code: CortexContractFindingCode.MissingRuntimeDocument,
      file: workflow,
    }),
  ]);
});

test('requires an exact runtime command prefix boundary', () => {
  const workflow = '.cortex/gizmo/workflows/subagent-delegation.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [],
      policies: [],
      runtimes: [
        {
          document: workflow,
          allowedCommandPrefixes: ['task skills:run'],
          requiredCommandPrefixes: ['task skills:run'],
          retiredCommandPrefixes: [],
        },
      ],
    },
    documents: [
      {
        relativePath: workflow,
        references: [],
        commands: ['task skills:runaway REQUEST_YAML=strict-yaml'],
      },
    ],
  };
  expect(CortexConsistencyContract.from(compileRequest).execute()).toHaveLength(
    2,
  );
  expect(CortexConsistencyContract.from(compileRequest).execute()).toEqual([
    expect.objectContaining({
      message:
        'Cortex workflow names an unregistered runtime entrypoint: task skills:runaway REQUEST_YAML=strict-yaml',
    }),
    expect.objectContaining({
      message:
        'Cortex workflow is missing its required runtime entrypoint: task skills:run',
    }),
  ]);
});

test('rejects an imported policy without an authority reference', () => {
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.request([]),
    ).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  );
});

test('rejects context ownership disguised by traversal', () => {
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [
        {
          authorityDocument:
            CortexConsistencyAuditScenario.adversarialAuthority(
              '.cortex/teams/web-dev/../../rogue/AGENTS.md',
            ),
          ownsAreas: [],
          imports: [],
        },
      ],
      policies: [],
      runtimes: [],
    },
    documents: [
      {
        relativePath: '.cortex/teams/web-dev/../../rogue/AGENTS.md',
        references: [],
        commands: [],
      },
    ],
  };
  expect(
    CortexConsistencyContract.from(compileRequest).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: '.cortex/rogue/AGENTS.md',
    }),
  );
});

test('rejects a non-authority document under a recognized owner', () => {
  const nonAuthority = '.cortex/teams/sre/dynamic-skills/typescript-policy.md';
  const compileRequest = CortexConsistencyAuditScenario.request([
    '../web-dev/dynamic-skills/typescript-enums-over-booleans.md',
  ]);
  const invalidRequest: AuditCortexContractsArgs = {
    ...compileRequest,
    registry: {
      ...compileRequest.registry,
      contexts: [
        {
          authorityDocument:
            CortexConsistencyAuditScenario.adversarialAuthority(nonAuthority),
          ownsAreas: [CortexPolicyArea.GithubTypescript],
          imports: [POLICY],
        },
      ],
    },
    documents: [
      { relativePath: nonAuthority, references: [POLICY], commands: [] },
      { relativePath: POLICY, references: [], commands: [] },
    ],
  };
  expect(
    CortexConsistencyContract.from(invalidRequest).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: nonAuthority,
    }),
  );
});

test('preserves leading traversal so it cannot alias a canonical authority', () => {
  const escapedAuthority = '../.cortex/AGENTS.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [
        {
          authorityDocument:
            CortexConsistencyAuditScenario.adversarialAuthority(
              escapedAuthority,
            ),
          ownsAreas: [],
          imports: [],
        },
      ],
      policies: [],
      runtimes: [],
    },
    documents: [
      { relativePath: escapedAuthority, references: [], commands: [] },
    ],
  };
  expect(
    CortexConsistencyContract.from(compileRequest).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: escapedAuthority,
    }),
  );
});

test('rejects uncovered foreign policy and invalid policy ownership', () => {
  const roguePolicy = '.cortex/rogue/policy.md';
  const compileRequest = CortexConsistencyAuditScenario.request([]);
  expect(
    CortexConsistencyContract.from({
      ...compileRequest,
      registry: {
        ...compileRequest.registry,
        contexts: [{ ...compileRequest.registry.contexts[0]!, imports: [] }],
      },
    }).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyImport,
      file: AUTHORITY,
    }),
  );
  expect(
    CortexConsistencyContract.from({
      registry: {
        contexts: [],
        policies: [
          {
            document: roguePolicy,
            kind: CortexPolicyContractKind.General,
            areas: [CortexPolicyArea.CortexAuthoring],
            capabilities: [],
          },
        ],
        runtimes: [],
      },
      documents: [{ relativePath: roguePolicy, references: [], commands: [] }],
    }).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidPolicyOwner,
      file: roguePolicy,
    }),
  );
});

type PersistedRequestArgs = {
  readonly schemaAuthority: string;
  readonly evidence: readonly CortexCompatibilityEvidence[];
  readonly references?: readonly string[];
};

test('requires compatibility evidence and a valid referenced schema authority', () => {
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.persistedRequest({
        schemaAuthority: SCHEMA_POLICY,
        evidence: [],
      }),
    ).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingCompatibilityEvidence,
    }),
  );
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.persistedRequest({
        schemaAuthority: '.cortex/missing.md',
        evidence: [CortexCompatibilityEvidence.LegacyDecodeTest],
      }),
    ).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidSchemaAuthority,
    }),
  );
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.persistedRequest({
        schemaAuthority: SCHEMA_POLICY,
        evidence: [CortexCompatibilityEvidence.MigrationTest],
      }),
    ).execute(),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingSchemaAuthorityReference,
    }),
  );
  expect(
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.persistedRequest({
        schemaAuthority: SCHEMA_POLICY,
        evidence: [CortexCompatibilityEvidence.MigrationTest],
        references: ['../design-docs/vault-schema-versioning.md'],
      }),
    ).execute(),
  ).toEqual([]);
});
