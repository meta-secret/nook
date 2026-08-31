export enum CortexPolicyArea {
  CortexAuthoring = 'cortex-authoring',
  GithubTypescript = 'github-typescript',
}

export enum CortexPolicyCapability {
  SchemaVersioning = 'schema-versioning',
}

export enum CortexCompatibilityEvidence {
  LegacyDecodeTest = 'legacy-decode-test',
  MigrationTest = 'migration-test',
}

export enum CortexPolicyContractKind {
  General = 'general',
  PersistedRepresentation = 'persisted-representation',
}

export enum CortexConsistencyContractKind {
  Request = 'cortex-consistency-compile-v1',
  Result = 'cortex-consistency-findings-v1',
}

export enum CortexContextAuthorityDocument {
  Root = '.cortex/AGENTS.md',
  Gizmo = '.cortex/gizmo/AGENTS.md',
  Shared = '.cortex/shared/AGENTS.md',
  Ai = '.cortex/teams/ai/AGENTS.md',
  DevelopmentCore = '.cortex/teams/dev-core/AGENTS.md',
  Security = '.cortex/teams/security/AGENTS.md',
  Sre = '.cortex/teams/sre/AGENTS.md',
  WebDevelopment = '.cortex/teams/web-dev/AGENTS.md',
}
export const CORTEX_CONSISTENCY_DOCUMENT_LIMIT = 10_000;
export const CORTEX_CONSISTENCY_REFERENCE_LIMIT = 10_000;
export const CORTEX_CONSISTENCY_PATH_LIMIT = 4_096;
export const CORTEX_CONSISTENCY_REQUEST_BYTE_LIMIT = 4 * 1_024 * 1_024;
export const CORTEX_CONSISTENCY_RESULT_BYTE_LIMIT = 1_024 * 1_024;

type CortexPolicyContractBase = {
  readonly document: string;
  readonly areas: readonly CortexPolicyArea[];
  readonly capabilities: readonly CortexPolicyCapability[];
};

export type CortexGeneralPolicyContract = CortexPolicyContractBase & {
  readonly kind: CortexPolicyContractKind.General;
};

export type CortexPersistedRepresentationPolicyContract =
  CortexPolicyContractBase & {
    readonly kind: CortexPolicyContractKind.PersistedRepresentation;
    readonly schemaAuthority: string;
    readonly evidence: readonly CortexCompatibilityEvidence[];
  };

export type CortexPolicyContract =
  CortexGeneralPolicyContract | CortexPersistedRepresentationPolicyContract;

export type CortexContextContract = {
  readonly authorityDocument: CortexContextAuthorityDocument;
  readonly ownsAreas: readonly CortexPolicyArea[];
  readonly imports: readonly string[];
};
export type CortexContractRegistry = {
  readonly contexts: readonly CortexContextContract[];
  readonly policies: readonly CortexPolicyContract[];
};

export type CortexContractDocument = {
  readonly relativePath: string;
  readonly references: readonly string[];
};

export enum CortexContractFindingCode {
  DuplicateContext = 'duplicate-context',
  DuplicatePolicy = 'duplicate-policy',
  InvalidContextOwner = 'invalid-context-owner',
  InvalidPolicyOwner = 'invalid-policy-owner',
  InvalidSchemaAuthority = 'invalid-schema-authority',
  MissingAuthorityDocument = 'missing-authority-document',
  MissingCompatibilityEvidence = 'missing-compatibility-evidence',
  MissingPolicyDocument = 'missing-policy-document',
  MissingPolicyImport = 'missing-policy-import',
  MissingPolicyReference = 'missing-policy-reference',
  MissingSchemaAuthorityReference = 'missing-schema-authority-reference',
  UnknownPolicyImport = 'unknown-policy-import',
}

export type CortexContractFinding = {
  readonly code: CortexContractFindingCode;
  readonly file: string;
  readonly message: string;
};

export type CompileCortexContractsRequest = {
  readonly kind: CortexConsistencyContractKind.Request;
  readonly documents: readonly CortexContractDocument[];
};

export type AuditCortexContractsArgs = {
  readonly registry: CortexContractRegistry;
  readonly documents: readonly CortexContractDocument[];
};

export type CortexConsistencyResult = {
  readonly kind: CortexConsistencyContractKind.Result;
  readonly findings: readonly CortexContractFinding[];
};
