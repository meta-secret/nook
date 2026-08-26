import { expect, test } from 'bun:test';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import type { RegisteredExecutableSkill } from '../../src/executable-skills/domain.ts';
import { ExecutableSkillValidationKind } from '../../src/executable-skills/domain.ts';
import type { AuditedExecutableSkillRegistry } from '../../src/executable-skills/registry.ts';
import {
  executeExecutableSkill,
  resolveVerifiedExecutableSkillExecution,
  snapshotExecutableSkillRuntimeRequest,
  validateRegisteredExecutableSkillRequest,
  validateRegisteredExecutableSkillResult,
  type ExecuteExecutableSkillRequest,
  type ResolveVerifiedExecutableSkillExecutionRequest,
  type VerifiedExecutableSkillExecution,
  type ValidateRegisteredExecutableSkillRequestRequest,
  type ValidateRegisteredExecutableSkillResultRequest,
} from '../../src/executable-skills/runtime.ts';
import { FIXTURE_REGISTRATION } from './fixture.ts';

test('rejects forged registry authority before runtime execution', async () => {
  const forgedRegistryValue: AuditedExecutableSkillRegistry = {
    auditId: 'forged',
  };
  const forgedRegistryAuthority = Object.freeze(forgedRegistryValue);
  const request: ExecuteExecutableSkillRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registryAuthority: forgedRegistryAuthority,
    serializedRequest: '{}',
    signal: false,
    skillId: 'fixture',
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('registry authority is invalid'),
  };

  await expect(executeExecutableSkill(request)).rejects.toMatchObject(
    expectedFailure,
  );
});

test('snapshots caller-owned request values before execution awaits', () => {
  const forgedRegistryValue: AuditedExecutableSkillRegistry = {
    auditId: 'forged',
  };
  const mutableRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registryAuthority: Object.freeze(forgedRegistryValue),
    serializedRequest: '{"value":"before"}',
    signal: false as const,
    skillId: 'fixture',
  };
  const snapshot = snapshotExecutableSkillRuntimeRequest(mutableRequest);

  mutableRequest.serializedRequest = '{"value":"after"}';
  mutableRequest.skillId = 'mutated';

  expect(snapshot.serializedRequest).toBe('{"value":"before"}');
  expect(snapshot.skillId).toBe('fixture');
  expect(Object.isFrozen(snapshot)).toBe(true);
});

test('validates serialized output through the registered host contract', () => {
  const acceptedRequest: ValidateRegisteredExecutableSkillResultRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registration: FIXTURE_REGISTRATION,
    serializedResult: '{"kind":"fixture-result-v1","schemaVersion":1}',
    signal: false,
  };
  validateRegisteredExecutableSkillResult(acceptedRequest);
  const rejectedRequest: ValidateRegisteredExecutableSkillResultRequest = {
    ...acceptedRequest,
    registration: FIXTURE_REGISTRATION,
    serializedResult: '{"kind":"wrong","schemaVersion":1}',
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('serialized contract is invalid'),
  };

  expect(() =>
    validateRegisteredExecutableSkillResult(rejectedRequest),
  ).toThrow(expect.objectContaining(expectedFailure));
});

test('validates serialized input through the registered host contract', () => {
  const acceptedRequest: ValidateRegisteredExecutableSkillRequestRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registration: FIXTURE_REGISTRATION,
    serializedRequest: '{"kind":"fixture-request-v1","schemaVersion":1}',
    signal: false,
  };
  validateRegisteredExecutableSkillRequest(acceptedRequest);
  const rejectedRequest: ValidateRegisteredExecutableSkillRequestRequest = {
    ...acceptedRequest,
    registration: FIXTURE_REGISTRATION,
    serializedRequest: '{"kind":"wrong","schemaVersion":1}',
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('serialized contract is invalid'),
  };

  expect(() =>
    validateRegisteredExecutableSkillRequest(rejectedRequest),
  ).toThrow(expect.objectContaining(expectedFailure));
});

test('rejects malformed and unsupported finite request contracts', () => {
  const malformedRequest: ValidateRegisteredExecutableSkillRequestRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registration: FIXTURE_REGISTRATION,
    serializedRequest: '{',
    signal: false,
  };
  const malformedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
  };
  expect(() =>
    validateRegisteredExecutableSkillRequest(malformedRequest),
  ).toThrow(expect.objectContaining(malformedFailure));
  const registrationValue: RegisteredExecutableSkill = {
    ...FIXTURE_REGISTRATION,
    requestValidation: 'invalid' as ExecutableSkillValidationKind,
  };
  const rejectedRequest: ValidateRegisteredExecutableSkillRequestRequest = {
    ...malformedRequest,
    registration: Object.freeze(registrationValue),
    serializedRequest: '{"kind":"fixture-request-v1","schemaVersion":1}',
  };
  const rejectedFailure = {
    message: expect.stringContaining('invalid'),
  };
  expect(() =>
    validateRegisteredExecutableSkillRequest(rejectedRequest),
  ).toThrow(expect.objectContaining(rejectedFailure));
});

test('rejects authority after request or result validation exhausts its deadline', () => {
  const expiredAt = Date.now() - 1;
  const requestValidation: ValidateRegisteredExecutableSkillRequestRequest = {
    deadlineExpiresAt: expiredAt,
    registration: FIXTURE_REGISTRATION,
    serializedRequest: '{"kind":"fixture-request-v1","schemaVersion":1}',
    signal: false,
  };
  const resultValidation: ValidateRegisteredExecutableSkillResultRequest = {
    deadlineExpiresAt: expiredAt,
    registration: FIXTURE_REGISTRATION,
    serializedResult: '{"kind":"fixture-result-v1","schemaVersion":1}',
    signal: false,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('no longer active'),
  };

  expect(() =>
    validateRegisteredExecutableSkillRequest(requestValidation),
  ).toThrow(expect.objectContaining(expectedFailure));
  expect(() =>
    validateRegisteredExecutableSkillResult(resultValidation),
  ).toThrow(expect.objectContaining(expectedFailure));
});

test('rejects an unsupported finite host validation kind', () => {
  const registrationValue: RegisteredExecutableSkill = {
    ...FIXTURE_REGISTRATION,
    resultValidation: 'invalid' as ExecutableSkillValidationKind,
  };
  const registration = Object.freeze(registrationValue);
  const request: ValidateRegisteredExecutableSkillResultRequest = {
    deadlineExpiresAt: Date.now() + 30_000,
    registration,
    serializedResult: '{"kind":"fixture-result-v1","schemaVersion":1}',
    signal: false,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('validation kind is invalid'),
  };

  expect(() => validateRegisteredExecutableSkillResult(request)).toThrow(
    expect.objectContaining(expectedFailure),
  );
});

test('rejects structurally forged execution authority', () => {
  const forgedValue: VerifiedExecutableSkillExecution = {
    executionId: '12345678-1234-1234-1234-123456789abc',
  };
  const forged = Object.freeze(forgedValue);
  const request: ResolveVerifiedExecutableSkillExecutionRequest = {
    authority: forged,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('execution authority is invalid'),
  };

  expect(() => resolveVerifiedExecutableSkillExecution(request)).toThrow(
    expect.objectContaining(expectedFailure),
  );
});
