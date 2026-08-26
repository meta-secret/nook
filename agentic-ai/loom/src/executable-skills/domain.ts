export enum ExecutableSkillExecutionKind {
  DockerReadOnly = 'docker-read-only',
}

export const MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS = 2_000;

export enum ExecutableSkillClosureEntryRole {
  ExecutionSource = 'execution-source',
  LockProvenance = 'lock-provenance',
  ManifestProvenance = 'manifest-provenance',
  PackageProvenance = 'package-provenance',
  PolicyProvenance = 'policy-provenance',
}

export type ExecutableSkillClosureEntry = {
  readonly content: string;
  readonly contentSha256: string;
  readonly relativePath: string;
  readonly role: ExecutableSkillClosureEntryRole;
};

export type ExecutableSkillClosurePlan = {
  readonly closureSha256: string;
  readonly entries: readonly ExecutableSkillClosureEntry[];
  readonly runnerRelativePath: string;
  readonly sourceTree: string;
};

export enum ExecutableSkillRegistryFindingCode {
  DuplicateId = 'duplicate-executable-skill-id',
  InvalidManifest = 'invalid-executable-skill-manifest',
  MissingRegistration = 'missing-executable-skill-registration',
  UnexpectedRegistration = 'unexpected-executable-skill-registration',
  UnsafeCapability = 'unsafe-executable-skill-capability',
  UnsafeFile = 'unsafe-executable-skill-file',
  WorktreeDrift = 'executable-skill-worktree-drift',
}

export type ExecutableSkillLimits = {
  readonly requestBytes: number;
  readonly resultBytes: number;
  readonly timeoutMs: number;
};

export type ExecutableSkillManifest = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly executionKind: ExecutableSkillExecutionKind;
  readonly requestKind: string;
  readonly resultKind: string;
  readonly policyPaths: readonly string[];
  readonly limits: ExecutableSkillLimits;
};

export type ExecutableSkillResultValidationRequest = {
  readonly expectedKind: string;
  readonly schemaVersion: 1;
  readonly serializedResult: string;
};

export enum ExecutableSkillResultValidation {
  Valid = 'valid',
}

export type ExecutableSkillResultValidator = (
  request: ExecutableSkillResultValidationRequest,
) => ExecutableSkillResultValidation | false;

export type RegisteredExecutableSkill = {
  readonly skillId: string;
  readonly manifest: ExecutableSkillManifest;
  readonly manifestPath: string;
  readonly runnerPath: string;
  readonly validateResult: ExecutableSkillResultValidator;
};

export type ExecutableSkillRegistryFinding = {
  readonly code: ExecutableSkillRegistryFindingCode;
  readonly skillId: string;
  readonly path: string;
  readonly message: string;
};

export type AuditExecutableSkillRegistryRequest = {
  readonly deadlineExpiresAt: number;
  readonly repositoryRoot: string;
  readonly signal: AbortSignal | false;
};
