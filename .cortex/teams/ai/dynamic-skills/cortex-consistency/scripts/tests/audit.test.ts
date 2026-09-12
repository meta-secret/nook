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
  type CortexContractFinding,
} from '../src/domain.ts';

export class CortexConsistencyAuditScenario {
  private constructor(private readonly request: readonly string[]) {}

  static hasFinding(
    ...[findings, expected]: FindingExpectation
  ): boolean {
    return findings.some(
      (finding) =>
        (!('code' in expected) || finding.code === expected.code) &&
        (!('file' in expected) || finding.file === expected.file) &&
        (!('message' in expected) || finding.message === expected.message),
    );
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
  const findings = CortexConsistencyContract.from(compileRequest).execute();
  expect(findings).toHaveLength(3);
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: workflow,
      message:
        'Cortex workflow names an unregistered runtime entrypoint: task missing:runtime',
    }),
  ).toBe(true);
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: workflow,
    }),
  ).toBe(true);
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.RetiredRuntimeEntrypoint,
      file: workflow,
    }),
  ).toBe(true);
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
  const findings = CortexConsistencyContract.from(compileRequest).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.MissingRuntimeDocument,
      file: workflow,
    }),
  ).toBe(true);
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
  const findings = CortexConsistencyContract.from(compileRequest).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      message:
        'Cortex workflow names an unregistered runtime entrypoint: task skills:runaway REQUEST_YAML=strict-yaml',
    }),
  ).toBe(true);
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      message:
        'Cortex workflow is missing its required runtime entrypoint: task skills:run',
    }),
  ).toBe(true);
});

test('rejects an imported policy without an authority reference', () => {
  const findings =
    CortexConsistencyContract.from(
      CortexConsistencyAuditScenario.request([]),
    ).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  ).toBe(true);
});

test('rejects context ownership disguised by traversal', () => {
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [
        {
          authorityDocument: '.cortex/teams/web-dev/../../rogue/AGENTS.md',
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
  const findings = CortexConsistencyContract.from(compileRequest).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.InvalidContextOwner,
      file: '.cortex/rogue/AGENTS.md',
    }),
  ).toBe(true);
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
          authorityDocument: nonAuthority,
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
  const findings = CortexConsistencyContract.from(invalidRequest).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.InvalidContextOwner,
      file: nonAuthority,
    }),
  ).toBe(true);
});

test('preserves leading traversal so it cannot alias a canonical authority', () => {
  const escapedAuthority = '../.cortex/AGENTS.md';
  const compileRequest: AuditCortexContractsArgs = {
    registry: {
      contexts: [
        {
          authorityDocument: escapedAuthority,
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
  const findings = CortexConsistencyContract.from(compileRequest).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(findings, {
      code: CortexContractFindingCode.InvalidContextOwner,
      file: escapedAuthority,
    }),
  ).toBe(true);
});

test('rejects uncovered foreign policy and invalid policy ownership', () => {
  const roguePolicy = '.cortex/rogue/policy.md';
  const compileRequest = CortexConsistencyAuditScenario.request([]);
  const [context] = compileRequest.registry.contexts;
  if (!context) throw new Error('Expected context fixture');
  const missingImportFindings =
    CortexConsistencyContract.from({
      ...compileRequest,
      registry: {
        ...compileRequest.registry,
        contexts: [{ ...context, imports: [] }],
      },
    }).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(missingImportFindings, {
      code: CortexContractFindingCode.MissingPolicyImport,
      file: AUTHORITY,
    }),
  ).toBe(true);
  const invalidOwnerFindings =
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
    }).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(invalidOwnerFindings, {
      code: CortexContractFindingCode.InvalidPolicyOwner,
      file: roguePolicy,
    }),
  ).toBe(true);
});

type PersistedRequestArgs = {
  readonly schemaAuthority: string;
  readonly evidence: readonly CortexCompatibilityEvidence[];
  readonly references?: readonly string[];
};

type FindingExpectation = readonly [
  findings: readonly CortexContractFinding[],
  expected: Partial<CortexContractFinding>,
];

test('requires compatibility evidence and a valid referenced schema authority', () => {
  const missingEvidence = CortexConsistencyContract.from(
    CortexConsistencyAuditScenario.persistedRequest({
      schemaAuthority: SCHEMA_POLICY,
      evidence: [],
    }),
  ).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(missingEvidence, {
      code: CortexContractFindingCode.MissingCompatibilityEvidence,
    }),
  ).toBe(true);
  const invalidAuthority = CortexConsistencyContract.from(
    CortexConsistencyAuditScenario.persistedRequest({
      schemaAuthority: '.cortex/missing.md',
      evidence: [CortexCompatibilityEvidence.LegacyDecodeTest],
    }),
  ).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(invalidAuthority, {
      code: CortexContractFindingCode.InvalidSchemaAuthority,
    }),
  ).toBe(true);
  const missingReference = CortexConsistencyContract.from(
    CortexConsistencyAuditScenario.persistedRequest({
      schemaAuthority: SCHEMA_POLICY,
      evidence: [CortexCompatibilityEvidence.MigrationTest],
    }),
  ).execute();
  expect(
    CortexConsistencyAuditScenario.hasFinding(missingReference, {
      code: CortexContractFindingCode.MissingSchemaAuthorityReference,
    }),
  ).toBe(true);
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
