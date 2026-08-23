export enum ExecutableSkillExecutionKind {
  DockerReadOnly = 'docker-read-only',
}

export enum ExecutableSkillRegistryFindingCode {
  DuplicateId = 'duplicate-executable-skill-id',
  InvalidManifest = 'invalid-executable-skill-manifest',
  MissingRegistration = 'missing-executable-skill-registration',
  UnexpectedRegistration = 'unexpected-executable-skill-registration',
  UnsafeCapability = 'unsafe-executable-skill-capability',
  UnsafeFile = 'unsafe-executable-skill-file',
}

export enum ExecutableSkillPayloadKind {
  Request = 'request',
  Result = 'result',
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

export type RegisteredExecutableSkill = {
  readonly skillId: string;
  readonly manifest: ExecutableSkillManifest;
  readonly manifestPath: string;
  readonly runnerPath: string;
};

export type ExecuteRegisteredSkillRequest = {
  readonly skillId: string;
  readonly serializedRequest: string;
};

export type VerifiedExecutableSkillExecution = {
  readonly closureSha256: string;
  readonly skillId: string;
  readonly schemaVersion: 1;
  readonly executionKind: ExecutableSkillExecutionKind;
  readonly requestKind: string;
  readonly resultKind: string;
  readonly requestSha256: string;
  readonly resultSha256: string;
  readonly runtimeImageDigest: string;
  readonly serializedResult: string;
  readonly sourceTree: string;
};

export type ExecutableSkillRegistryFinding = {
  readonly code: ExecutableSkillRegistryFindingCode;
  readonly skillId: string;
  readonly message: string;
};

export type AuditExecutableSkillRegistryRequest = {
  readonly repositoryRoot: string;
};
