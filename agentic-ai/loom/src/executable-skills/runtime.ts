import { createHash, randomUUID } from 'node:crypto';
import { ExecutableSkillValidationKind } from './domain.ts';
import type {
  ExecutableSkillExecutionKind,
  RegisteredExecutableSkill,
} from './domain.ts';
import type { AuditedExecutableSkillRegistry } from './registry.ts';
import { resolveAuditedExecutableSkill } from './registry.ts';
import {
  executeExecutableSkillContainer,
  type ExecutableSkillContainerCandidate,
  type ExecuteExecutableSkillContainerRequest,
} from './runtime-docker.ts';
import {
  throwExecutableSkillRuntimeFailure,
  type ThrowExecutableSkillRuntimeFailureRequest,
} from './runtime-failure.ts';

export type ExecuteExecutableSkillRequest = {
  readonly deadlineExpiresAt: number;
  readonly registryAuthority: AuditedExecutableSkillRegistry;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
  readonly skillId: string;
};

export type VerifiedExecutableSkillExecution = {
  readonly executionId: string;
};

export type ExecutableSkillExecutionReceipt = {
  readonly closureSha256: string;
  readonly executionKind: ExecutableSkillExecutionKind;
  readonly imageDigest: string;
  readonly requestKind: string;
  readonly requestSha256: string;
  readonly resultKind: string;
  readonly resultSha256: string;
  readonly schemaVersion: 1;
  readonly serializedResult: string;
  readonly skillId: string;
  readonly sourceTree: string;
};

export type ExecutableSkillContainerExecutor = (
  request: ExecuteExecutableSkillContainerRequest,
) => Promise<ExecutableSkillContainerCandidate>;

export type ExecutableSkillRuntimeDependencies = {
  readonly executeContainer: ExecutableSkillContainerExecutor;
};

export type ExecuteExecutableSkillWithDependenciesRequest = {
  readonly dependencies: ExecutableSkillRuntimeDependencies;
  readonly request: ExecuteExecutableSkillRequest;
};

export type ResolveVerifiedExecutableSkillExecutionRequest = {
  readonly authority: VerifiedExecutableSkillExecution;
};

const verifiedExecutionBindings = new WeakMap<
  VerifiedExecutableSkillExecution,
  ExecutableSkillExecutionReceipt
>();

export async function executeExecutableSkill(
  request: ExecuteExecutableSkillRequest,
): Promise<VerifiedExecutableSkillExecution> {
  const dependencies: ExecutableSkillRuntimeDependencies = {
    executeContainer: executeExecutableSkillContainer,
  };
  const execution: ExecuteExecutableSkillWithDependenciesRequest = {
    dependencies,
    request,
  };
  const receipt = await executeExecutableSkillWithDependencies(execution);
  const authorityValue: VerifiedExecutableSkillExecution = {
    executionId: randomUUID(),
  };
  const authority = Object.freeze(authorityValue);
  verifiedExecutionBindings.set(authority, receipt);
  return authority;
}

export async function executeExecutableSkillWithDependencies(
  execution: ExecuteExecutableSkillWithDependenciesRequest,
): Promise<ExecutableSkillExecutionReceipt> {
  const request = snapshotExecutableSkillRuntimeRequest(execution.request);
  const broadRequestBound: PayloadBoundRequest = {
    label: 'request',
    maximumBytes: 16 * 1024 * 1024,
    value: request.serializedRequest,
  };
  let resolved: ReturnType<typeof resolveAuditedExecutableSkill>;
  try {
    assertRuntimeActive(request);
    assertPayloadBound(broadRequestBound);
    const resolutionRequest = {
      authority: request.registryAuthority,
      deadlineExpiresAt: request.deadlineExpiresAt,
      signal: request.signal,
      skillId: request.skillId,
    };
    resolved = resolveAuditedExecutableSkill(resolutionRequest);
    const manifestRequestBound: PayloadBoundRequest = {
      label: 'request',
      maximumBytes: resolved.registration.manifest.limits.requestBytes,
      value: request.serializedRequest,
    };
    assertPayloadBound(manifestRequestBound);
    const validationRequest: ValidateRegisteredExecutableSkillRequestRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      registration: resolved.registration,
      serializedRequest: request.serializedRequest,
      signal: request.signal,
    };
    validateRegisteredExecutableSkillRequest(validationRequest);
    assertRuntimeActive(request);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill admission failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
  const containerRequest: ExecuteExecutableSkillContainerRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    registryAuthority: request.registryAuthority,
    serializedRequest: request.serializedRequest,
    signal: request.signal,
    skillId: request.skillId,
  };
  let candidate: ExecutableSkillContainerCandidate;
  try {
    const candidateValue =
      await execution.dependencies.executeContainer(containerRequest);
    const candidateSnapshot: ExecutableSkillContainerCandidate = {
      imageDigest: candidateValue.imageDigest,
      serializedResult: candidateValue.serializedResult,
    };
    candidate = Object.freeze(candidateSnapshot);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error ? error : 'Executable skill execution failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
  try {
    assertRuntimeActive(request);
    const resultBound: PayloadBoundRequest = {
      label: 'result',
      maximumBytes: resolved.registration.manifest.limits.resultBytes,
      value: candidate.serializedResult,
    };
    assertPayloadBound(resultBound);
    const validationRequest: ValidateRegisteredExecutableSkillResultRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      registration: resolved.registration,
      serializedResult: candidate.serializedResult,
      signal: request.signal,
    };
    validateRegisteredExecutableSkillResult(validationRequest);
    assertRuntimeActive(request);
    if (!/^sha256:[0-9a-f]{64}$/u.test(candidate.imageDigest)) {
      throw new Error('Executable skill runtime image identity is invalid.');
    }
    const manifest = resolved.registration.manifest;
    const receipt: ExecutableSkillExecutionReceipt = {
      closureSha256: resolved.closurePlan.closureSha256,
      executionKind: manifest.executionKind,
      imageDigest: candidate.imageDigest,
      requestKind: manifest.requestKind,
      requestSha256: sha256(request.serializedRequest),
      resultKind: manifest.resultKind,
      resultSha256: sha256(candidate.serializedResult),
      schemaVersion: manifest.schemaVersion,
      serializedResult: candidate.serializedResult,
      skillId: resolved.registration.skillId,
      sourceTree: resolved.closurePlan.sourceTree,
    };
    return Object.freeze(receipt);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill verification failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

export type ValidateRegisteredExecutableSkillResultRequest = {
  readonly deadlineExpiresAt: number;
  readonly registration: RegisteredExecutableSkill;
  readonly serializedResult: string;
  readonly signal: AbortSignal | false;
};

export type ValidateRegisteredExecutableSkillRequestRequest = {
  readonly deadlineExpiresAt: number;
  readonly registration: RegisteredExecutableSkill;
  readonly serializedRequest: string;
  readonly signal: AbortSignal | false;
};

export function validateRegisteredExecutableSkillRequest(
  request: ValidateRegisteredExecutableSkillRequestRequest,
): void {
  try {
    const manifest = request.registration.manifest;
    const validationRequest: ValidateExecutableSkillSerializedContractRequest =
      {
        expectedKind: manifest.requestKind,
        serializedValue: request.serializedRequest,
        validationKind: request.registration.requestValidation,
      };
    validateExecutableSkillSerializedContract(validationRequest);
    assertRuntimeValidationActive(request);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill request contract validation failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

export function validateRegisteredExecutableSkillResult(
  request: ValidateRegisteredExecutableSkillResultRequest,
): void {
  try {
    const manifest = request.registration.manifest;
    const validationRequest: ValidateExecutableSkillSerializedContractRequest =
      {
        expectedKind: manifest.resultKind,
        serializedValue: request.serializedResult,
        validationKind: request.registration.resultValidation,
      };
    validateExecutableSkillSerializedContract(validationRequest);
    assertRuntimeValidationActive(request);
  } catch (error) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error:
        error instanceof Error
          ? error
          : 'Executable skill result contract validation failed.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
}

type ValidateExecutableSkillSerializedContractRequest = {
  readonly expectedKind: string;
  readonly serializedValue: string;
  readonly validationKind: ExecutableSkillValidationKind;
};

type ExecutableSkillKindAndSchemaDocument = {
  readonly kind?: string;
  readonly schemaVersion?: number;
};

function validateExecutableSkillSerializedContract(
  request: ValidateExecutableSkillSerializedContractRequest,
): void {
  if (
    request.validationKind !== ExecutableSkillValidationKind.KindAndSchemaV1
  ) {
    throw new Error('Executable skill validation kind is invalid.');
  }
  const parsed: ExecutableSkillKindAndSchemaDocument = JSON.parse(
    request.serializedValue,
  );
  if (parsed.kind !== request.expectedKind || parsed.schemaVersion !== 1) {
    throw new Error('Executable skill serialized contract is invalid.');
  }
}

type ExecutableSkillRuntimeValidationActivityRequest = {
  readonly deadlineExpiresAt: number;
  readonly signal: AbortSignal | false;
};

function assertRuntimeValidationActive(
  request: ExecutableSkillRuntimeValidationActivityRequest,
): void {
  if (
    Date.now() >= request.deadlineExpiresAt ||
    (request.signal !== false && request.signal.aborted)
  ) {
    throw new Error('Executable skill runtime is no longer active.');
  }
}

export function snapshotExecutableSkillRuntimeRequest(
  request: ExecuteExecutableSkillRequest,
): ExecuteExecutableSkillRequest {
  const requestValue: ExecuteExecutableSkillRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    registryAuthority: request.registryAuthority,
    serializedRequest: request.serializedRequest,
    signal: request.signal,
    skillId: request.skillId,
  };
  return Object.freeze(requestValue);
}

export function resolveVerifiedExecutableSkillExecution(
  request: ResolveVerifiedExecutableSkillExecutionRequest,
): ExecutableSkillExecutionReceipt {
  const receipt = verifiedExecutionBindings.get(request.authority);
  if (!receipt) {
    const failureRequest: ThrowExecutableSkillRuntimeFailureRequest = {
      error: 'Executable skill execution authority is invalid.',
    };
    throwExecutableSkillRuntimeFailure(failureRequest);
  }
  return receipt;
}

type PayloadBoundRequest = {
  readonly label: string;
  readonly maximumBytes: number;
  readonly value: string;
};

function assertPayloadBound(request: PayloadBoundRequest): void {
  const bytes = new TextEncoder().encode(request.value).byteLength;
  if (bytes > request.maximumBytes) {
    throw new Error(
      `Executable skill ${request.label} exceeds its byte limit.`,
    );
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRuntimeActive(request: ExecuteExecutableSkillRequest): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill runtime was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill runtime deadline expired.');
  }
}
