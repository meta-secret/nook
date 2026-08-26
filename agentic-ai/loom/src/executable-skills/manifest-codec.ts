import {
  ExecutableSkillExecutionKind,
  MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS,
  type ExecutableSkillLimits,
  type ExecutableSkillManifest,
} from './domain.ts';
import {
  fieldNamesOf,
  type RequestFieldVocabulary,
} from '../codec/field-vocabulary.ts';

type ExecutableSkillLimitsTransport = {
  readonly requestBytes: number | false;
  readonly resultBytes: number | false;
  readonly timeoutMs: number | false;
};

type ExecutableSkillManifestTransport = {
  readonly schemaVersion: number | false;
  readonly id: string | false;
  readonly executionKind: string | false;
  readonly requestKind: string | false;
  readonly resultKind: string | false;
  readonly policyPaths: readonly string[] | false;
  readonly limits: ExecutableSkillLimitsTransport | false;
};

type BoundedIntegerRequest = {
  readonly value: number | false;
  readonly minimum: number;
  readonly maximum: number;
};

enum ExecutableSkillManifestField {
  SchemaVersion = 'schemaVersion',
  Id = 'id',
  ExecutionKind = 'executionKind',
  RequestKind = 'requestKind',
  ResultKind = 'resultKind',
  PolicyPaths = 'policyPaths',
  Limits = 'limits',
}
enum ExecutableSkillLimitField {
  RequestBytes = 'requestBytes',
  ResultBytes = 'resultBytes',
  TimeoutMilliseconds = 'timeoutMs',
}
const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTRACT_KIND = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;

export function decodeExecutableSkillManifest(
  manifestText: string,
): ExecutableSkillManifest {
  const transport = JSON.parse(
    manifestText,
  ) as ExecutableSkillManifestTransport;
  const exactManifestRequest: HasExactKeysRequest<ExecutableSkillManifestField> =
    {
      fields: ExecutableSkillManifestField,
      transport,
    };
  if (
    !transport ||
    !hasExactKeys(exactManifestRequest) ||
    transport.schemaVersion !== 1 ||
    typeof transport.id !== 'string' ||
    !SKILL_ID.test(transport.id) ||
    transport.executionKind !== ExecutableSkillExecutionKind.DockerReadOnly ||
    typeof transport.requestKind !== 'string' ||
    !CONTRACT_KIND.test(transport.requestKind) ||
    typeof transport.resultKind !== 'string' ||
    !CONTRACT_KIND.test(transport.resultKind) ||
    !isPolicyPaths(transport.policyPaths) ||
    !transport.limits
  ) {
    throw new Error('Invalid executable skill manifest.');
  }
  const limits = decodeLimits(transport.limits);
  const manifest: ExecutableSkillManifest = {
    schemaVersion: 1,
    id: transport.id,
    executionKind: ExecutableSkillExecutionKind.DockerReadOnly,
    requestKind: transport.requestKind,
    resultKind: transport.resultKind,
    policyPaths: Object.freeze([...transport.policyPaths]),
    limits,
  };
  return Object.freeze(manifest);
}

function decodeLimits(
  transport: ExecutableSkillLimitsTransport,
): ExecutableSkillLimits {
  const exactLimitRequest: HasExactKeysRequest<ExecutableSkillLimitField> = {
    fields: ExecutableSkillLimitField,
    transport,
  };
  const requestBytes: BoundedIntegerRequest = {
    value: transport.requestBytes,
    minimum: 1,
    maximum: 16 * 1024 * 1024,
  };
  const resultBytes: BoundedIntegerRequest = {
    value: transport.resultBytes,
    minimum: 1,
    maximum: 4 * 1024 * 1024,
  };
  const timeoutMs: BoundedIntegerRequest = {
    value: transport.timeoutMs,
    minimum: MINIMUM_EXECUTABLE_SKILL_TIMEOUT_MS,
    maximum: 300_000,
  };
  if (
    !hasExactKeys(exactLimitRequest) ||
    !isBoundedInteger(requestBytes) ||
    !isBoundedInteger(resultBytes) ||
    !isBoundedInteger(timeoutMs)
  ) {
    throw new Error('Invalid executable skill limits.');
  }
  const limits: ExecutableSkillLimits = {
    requestBytes: requestBytes.value,
    resultBytes: resultBytes.value,
    timeoutMs: timeoutMs.value,
  };
  return Object.freeze(limits);
}

type ExactTransport =
  ExecutableSkillLimitsTransport | ExecutableSkillManifestTransport;

type HasExactKeysRequest<FieldName extends string> = {
  readonly fields: RequestFieldVocabulary<FieldName>;
  readonly transport: ExactTransport;
};

function hasExactKeys<FieldName extends string>(
  request: HasExactKeysRequest<FieldName>,
): boolean {
  const fields = fieldNamesOf(request.fields);
  return (
    Object.keys(request.transport).length === fields.length &&
    fields.every((key) => Object.hasOwn(request.transport, key))
  );
}

function isPolicyPaths(
  paths: readonly string[] | false,
): paths is readonly string[] {
  return (
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.length <= 16 &&
    new Set(paths).size === paths.length &&
    paths.every(isSafeRelativePath)
  );
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.startsWith('.cortex/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function isBoundedInteger(
  request: BoundedIntegerRequest,
): request is BoundedIntegerRequest & { readonly value: number } {
  return (
    typeof request.value === 'number' &&
    Number.isSafeInteger(request.value) &&
    request.value >= request.minimum &&
    request.value <= request.maximum
  );
}
