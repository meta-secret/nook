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
  readonly authorityDocument: string;
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
  readonly registry: CortexContractRegistry;
  readonly documents: readonly CortexContractDocument[];
};

export type CortexConsistencyResult = {
  readonly kind: CortexConsistencyContractKind.Result;
  readonly findings: readonly CortexContractFinding[];
};
