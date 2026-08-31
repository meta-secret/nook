import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { compileCortexContracts as auditCortexContracts } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/audit.ts';
import type { CortexContractRegistry } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';
import { CORTEX_CONTRACT_REGISTRY } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/registry.ts';
import {
  adaptCortexContractDocuments,
  CortexCompatibilityEvidence,
  CortexContractFindingCode,
  CortexPolicyContractKind,
  CortexPolicyArea,
  CortexPolicyCapability,
  type CortexContractDocument,
} from '../src/lib/cortex-contracts.ts';

const SRE_AUTHORITY = '.cortex/teams/sre/AGENTS.md';
const WEB_BOOLEAN_POLICY =
  '.cortex/teams/web-dev/dynamic-skills/typescript-enums-over-booleans.md';
const RUST_POLICY = '.cortex/teams/dev-core/dynamic-skills/rust-coding.md';
const SCHEMA_POLICY =
  '.cortex/teams/dev-core/design-docs/vault-schema-versioning.md';
const REPOSITORY_ROOT = path.resolve(import.meta.dir, '..', '..', '..');

function defaultDocument(relativePath: string): CortexContractDocument {
  return { relativePath, content: '# Policy\n' };
}

type TestCortexDocumentArgs = {
  readonly relativePath: string;
  readonly content: string;
};

function document(args: TestCortexDocumentArgs): CortexContractDocument {
  return args;
}

type CompileTestCortexRegistryArgs = {
  readonly registry: CortexContractRegistry;
  readonly documents: readonly CortexContractDocument[];
};

function compile(args: CompileTestCortexRegistryArgs) {
  return auditCortexContracts({
    registry: args.registry,
    documents: adaptCortexContractDocuments(args.documents),
  });
}

test('rejects a foreign policy that covers an owned area without an import', () => {
  const registry = {
    contexts: [
      {
        authorityDocument: SRE_AUTHORITY,
        ownsAreas: [CortexPolicyArea.GithubTypescript],
        imports: [],
      },
    ],
    policies: [
      {
        document: WEB_BOOLEAN_POLICY,
        kind: CortexPolicyContractKind.General,
        areas: [CortexPolicyArea.GithubTypescript],
        capabilities: [],
      },
    ],
  } as const satisfies CortexContractRegistry;

  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [
      defaultDocument(SRE_AUTHORITY),
      defaultDocument(WEB_BOOLEAN_POLICY),
    ],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyImport,
      file: SRE_AUTHORITY,
    }),
  );
});

test('accepts the reviewed repository contract registry', () => {
  const registeredPaths = [
    ...CORTEX_CONTRACT_REGISTRY.contexts.map(
      (context) => context.authorityDocument,
    ),
    ...CORTEX_CONTRACT_REGISTRY.policies.map((policy) => policy.document),
  ];
  const documents = [...new Set(registeredPaths)].map((relativePath) => ({
    relativePath,
    content: readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
  }));
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry: CORTEX_CONTRACT_REGISTRY,
    documents,
  };

  expect(compile(compileArgs)).toEqual([]);
});

test('requires the importing authority to reference the policy document', () => {
  const registryArgs: ForeignTypescriptRegistryArgs = {
    imports: [WEB_BOOLEAN_POLICY],
  };
  const registry = foreignTypescriptRegistry(registryArgs);
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content: '# SRE\n\nNo policy link.\n',
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: SRE_AUTHORITY,
    }),
  );
});

test('rejects a context authority outside recognized ownership paths', () => {
  const rogueAuthority = '.cortex/rogue/AGENTS.md';
  const registry = {
    contexts: [
      {
        authorityDocument: rogueAuthority,
        ownsAreas: [CortexPolicyArea.GithubTypescript],
        imports: [],
      },
    ],
    policies: [
      {
        document: WEB_BOOLEAN_POLICY,
        kind: CortexPolicyContractKind.General,
        areas: [CortexPolicyArea.GithubTypescript],
        capabilities: [],
      },
    ],
  } as const satisfies CortexContractRegistry;
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [
      defaultDocument(rogueAuthority),
      defaultDocument(WEB_BOOLEAN_POLICY),
    ],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: rogueAuthority,
    }),
  );
  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyImport,
      file: rogueAuthority,
    }),
  );
});

test('normalizes traversal before resolving context ownership', () => {
  const authoredAuthority = '.cortex/teams/web-dev/../../rogue/AGENTS.md';
  const normalizedAuthority = '.cortex/rogue/AGENTS.md';
  const registry = {
    contexts: [
      {
        authorityDocument: authoredAuthority,
        ownsAreas: [],
        imports: [],
      },
    ],
    policies: [],
  } as const satisfies CortexContractRegistry;
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [defaultDocument(authoredAuthority)],
  };

  expect(compile(compileArgs)).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: normalizedAuthority,
    }),
  );
});

test('rejects a policy outside recognized ownership paths', () => {
  const roguePolicy = '.cortex/rogue/policy.md';
  const registry = {
    contexts: [],
    policies: [
      {
        document: roguePolicy,
        kind: CortexPolicyContractKind.General,
        areas: [CortexPolicyArea.CortexAuthoring],
        capabilities: [],
      },
    ],
  } as const satisfies CortexContractRegistry;
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [defaultDocument(roguePolicy)],
  };

  expect(compile(compileArgs)).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidPolicyOwner,
      file: roguePolicy,
    }),
  );
});

test('accepts a directly referenced foreign policy', () => {
  const registryArgs: ForeignTypescriptRegistryArgs = {
    imports: [WEB_BOOLEAN_POLICY],
  };
  const registry = foreignTypescriptRegistry(registryArgs);
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content: `# SRE\n\n- [Enum policy](../web-dev/dynamic-skills/typescript-enums-over-booleans.md)\n`,
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toEqual([]);
});

test('accepts a Markdown link with a title', () => {
  const registryArgs: ForeignTypescriptRegistryArgs = {
    imports: [WEB_BOOLEAN_POLICY],
  };
  const registry = foreignTypescriptRegistry(registryArgs);
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content:
      '# SRE\n\n[Enum policy](../web-dev/dynamic-skills/typescript-enums-over-booleans.md "Policy")\n',
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
  };

  expect(compile(compileArgs)).toEqual([]);
});

test('accepts a reference-style Markdown link', () => {
  const registryArgs: ForeignTypescriptRegistryArgs = {
    imports: [WEB_BOOLEAN_POLICY],
  };
  const registry = foreignTypescriptRegistry(registryArgs);
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content:
      '# SRE\n\nUse the [enum policy][boolean-policy].\n\n[boolean-policy]: ../web-dev/dynamic-skills/typescript-enums-over-booleans.md\n',
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
  };

  expect(compile(compileArgs)).toEqual([]);
});

test('accepts a Markdown link to a policy heading', () => {
  const registryArgs: ForeignTypescriptRegistryArgs = {
    imports: [WEB_BOOLEAN_POLICY],
  };
  const registry = foreignTypescriptRegistry(registryArgs);
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content:
      '# SRE\n\n[Enum validation](../web-dev/dynamic-skills/typescript-enums-over-booleans.md#validation)\n',
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
  };

  expect(compile(compileArgs)).toEqual([]);
});

test('accepts a Markdown link with a query and fragment', () => {
  const registry = foreignTypescriptRegistry({ imports: [WEB_BOOLEAN_POLICY] });
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content:
      '# SRE\n\n[Enum validation](../web-dev/dynamic-skills/typescript-enums-over-booleans.md?plain=1#validation)\n',
  };
  expect(
    compile({
      registry,
      documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
    }),
  ).toEqual([]);
});

test('uses the first duplicate Markdown reference definition', () => {
  const registry = foreignTypescriptRegistry({ imports: [WEB_BOOLEAN_POLICY] });
  const authorityArgs: TestCortexDocumentArgs = {
    relativePath: SRE_AUTHORITY,
    content:
      '# SRE\n\nUse [the policy][rule].\n\n[rule]: unrelated.md\n[rule]: ../web-dev/dynamic-skills/typescript-enums-over-booleans.md\n',
  };
  expect(
    compile({
      registry,
      documents: [document(authorityArgs), defaultDocument(WEB_BOOLEAN_POLICY)],
    }),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: SRE_AUTHORITY,
    }),
  );
});

test('rejects persisted representation policy without compatibility evidence', () => {
  const registryArgs: PersistedRustRegistryArgs = {
    schemaAuthority: SCHEMA_POLICY,
    evidence: [],
  };
  const registry = persistedRustRegistry(registryArgs);
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [defaultDocument(RUST_POLICY), defaultDocument(SCHEMA_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingCompatibilityEvidence,
      file: RUST_POLICY,
    }),
  );
});

test('rejects persisted representation policy without a schema authority', () => {
  const registryArgs: PersistedRustRegistryArgs = {
    schemaAuthority: '.cortex/teams/dev-core/design-docs/missing.md',
    evidence: [CortexCompatibilityEvidence.LegacyDecodeTest],
  };
  const registry = persistedRustRegistry(registryArgs);
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [defaultDocument(RUST_POLICY), defaultDocument(SCHEMA_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidSchemaAuthority,
      file: RUST_POLICY,
    }),
  );
});

test('accepts persisted policy with schema authority and migration evidence', () => {
  const registryArgs: PersistedRustRegistryArgs = {
    schemaAuthority: SCHEMA_POLICY,
    evidence: [CortexCompatibilityEvidence.MigrationTest],
  };
  const registry = persistedRustRegistry(registryArgs);
  const rustDocumentArgs: TestCortexDocumentArgs = {
    relativePath: RUST_POLICY,
    content:
      '# Rust policy\n\n[Schema authority](../design-docs/vault-schema-versioning.md)\n',
  };
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [document(rustDocumentArgs), defaultDocument(SCHEMA_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toEqual([]);
});

test('requires persisted policy to reference its schema authority', () => {
  const registryArgs: PersistedRustRegistryArgs = {
    schemaAuthority: SCHEMA_POLICY,
    evidence: [CortexCompatibilityEvidence.LegacyDecodeTest],
  };
  const registry = persistedRustRegistry(registryArgs);
  const compileArgs: CompileTestCortexRegistryArgs = {
    registry,
    documents: [defaultDocument(RUST_POLICY), defaultDocument(SCHEMA_POLICY)],
  };
  const findings = compile(compileArgs);

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingSchemaAuthorityReference,
      file: RUST_POLICY,
    }),
  );
});

type ForeignTypescriptRegistryArgs = {
  readonly imports: readonly string[];
};

function foreignTypescriptRegistry(
  args: ForeignTypescriptRegistryArgs,
): CortexContractRegistry {
  return {
    contexts: [
      {
        authorityDocument: SRE_AUTHORITY,
        ownsAreas: [CortexPolicyArea.GithubTypescript],
        imports: args.imports,
      },
    ],
    policies: [
      {
        document: WEB_BOOLEAN_POLICY,
        kind: CortexPolicyContractKind.General,
        areas: [CortexPolicyArea.GithubTypescript],
        capabilities: [],
      },
    ],
  };
}

type PersistedRustRegistryArgs = {
  readonly schemaAuthority: string;
  readonly evidence: readonly CortexCompatibilityEvidence[];
};

function persistedRustRegistry(
  args: PersistedRustRegistryArgs,
): CortexContractRegistry {
  return {
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
  };
}
