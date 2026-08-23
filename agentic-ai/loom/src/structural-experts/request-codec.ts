import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import type {
  ParentAgentAttempt,
  StructuralChildProjectionAuthorization,
} from '../agent-workflow/domain.ts';
import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import { StructuralExpertKind, structuralExpertProfile } from './catalog.ts';
import { safeRepositoryPath } from './audit.ts';

const MAX_REQUEST_BYTES = 131_072;
const MAX_INSTRUCTION_LENGTH = 16_384;

export type StructuralChildProjection = StructuralChildProjectionAuthorization;

type StructuralInvocationFields = {
  readonly runId: string;
  readonly expert: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly attempt: number;
  readonly depth: 2;
  readonly parent: ParentAgentAttempt;
  readonly instruction: string;
};

export type StructuralEvidenceInvocationRequest = StructuralInvocationFields & {
  readonly kind: StructuralExpertKind.RepositoryEvidence;
  readonly evidencePaths: readonly string[];
};

export type StructuralSynthesisInvocationRequest =
  StructuralInvocationFields & {
    readonly kind: StructuralExpertKind.VerifiedViewSynthesis;
    readonly childProjections: readonly StructuralChildProjection[];
  };

export type StructuralExpertInvocationRequest =
  StructuralEvidenceInvocationRequest | StructuralSynthesisInvocationRequest;

export function decodeStructuralExpertInvocationRequest(
  serialized: string,
): StructuralExpertInvocationRequest {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
    invalidRequest();
  }
  let node: UntrustedYamlNode;
  try {
    node = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    invalidRequest();
  }
  if (!isRecord(node)) invalidRequest();
  const reader = new StructuralRequestReader(node);
  const expert = reader.string('expert');
  const profile = structuralExpertProfile(expert);
  if (!profile) invalidRequest();
  const expectedKeys =
    profile.kind === StructuralExpertKind.RepositoryEvidence
      ? [
          'attempt',
          'depth',
          'evidencePaths',
          'expert',
          'instruction',
          'kind',
          'parent',
          'runId',
          'sourceCommit',
          'task',
        ]
      : [
          'attempt',
          'childProjections',
          'depth',
          'expert',
          'instruction',
          'kind',
          'parent',
          'runId',
          'sourceCommit',
          'task',
        ];
  if (
    JSON.stringify(Object.keys(node).sort()) !== JSON.stringify(expectedKeys)
  ) {
    invalidRequest();
  }
  const kind = reader.string('kind');
  if (kind !== profile.kind) invalidRequest();
  const commonRequest: DecodeCommonStructuralFieldsRequest = { expert, node };
  const fields = decodeCommonFields(commonRequest);
  if (profile.kind === StructuralExpertKind.RepositoryEvidence) {
    const evidenceRequest: DecodeEvidencePathsRequest = {
      node,
      profileFiles: profile.allowedEvidenceFiles,
      profileDescendantRoots: profile.allowedEvidenceDescendantRoots,
      excludedPaths: profile.excludedPaths,
    };
    return {
      ...fields,
      kind: StructuralExpertKind.RepositoryEvidence,
      evidencePaths: decodeEvidencePaths(evidenceRequest),
    };
  }
  return {
    ...fields,
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    childProjections: decodeChildProjections(node),
  };
}

export function validatedStructuralExpertInvocationRequest(
  request: StructuralExpertInvocationRequest,
): StructuralExpertInvocationRequest {
  return decodeStructuralExpertInvocationRequest(JSON.stringify(request));
}

type DecodeCommonStructuralFieldsRequest = {
  readonly expert: string;
  readonly node: UntrustedYamlMap;
};

function decodeCommonFields(
  request: DecodeCommonStructuralFieldsRequest,
): StructuralInvocationFields {
  const node = request.node;
  const reader = new StructuralRequestReader(node);
  const runId = reader.string('runId');
  const sourceCommit = reader.string('sourceCommit');
  const task = reader.string('task');
  const instruction = reader.string('instruction');
  const attempt = reader.number('attempt');
  const depth = reader.number('depth');
  const parent = requiredParent(node);
  if (
    !safeIdentifier(runId) ||
    !safeIdentifier(request.expert) ||
    !safeIdentifier(task) ||
    !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    depth !== 2 ||
    (task === parent.task && attempt === parent.attempt) ||
    instruction.trim() === '' ||
    instruction.length > MAX_INSTRUCTION_LENGTH ||
    containsForbiddenControl(instruction)
  ) {
    invalidRequest();
  }
  return {
    runId,
    expert: request.expert,
    sourceCommit,
    task,
    attempt,
    depth: 2,
    parent,
    instruction,
  };
}

type DecodeEvidencePathsRequest = {
  readonly node: UntrustedYamlMap;
  readonly profileFiles: readonly string[];
  readonly profileDescendantRoots: readonly string[];
  readonly excludedPaths: readonly string[];
};

function decodeEvidencePaths(
  request: DecodeEvidencePathsRequest,
): readonly string[] {
  const reader = new StructuralRequestReader(request.node);
  const value = reader.value('evidencePaths');
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    invalidRequest();
  }
  const paths = value.map((entry) => {
    if (typeof entry !== 'string') invalidRequest();
    return entry;
  });
  if (
    new Set(paths).size !== paths.length ||
    paths.some(
      (path) =>
        !safeRepositoryPath(path) ||
        (!request.profileFiles.includes(path) &&
          !request.profileDescendantRoots.some((root) => {
            const pathRequest: PathWithinRequest = { path, root };
            return strictDescendant(pathRequest);
          })) ||
        request.excludedPaths.some((root) => {
          const pathRequest: PathWithinRequest = { path, root };
          return pathWithin(pathRequest);
        }),
    )
  ) {
    invalidRequest();
  }
  return paths;
}

function decodeChildProjections(
  node: UntrustedYamlMap,
): readonly StructuralChildProjection[] {
  const reader = new StructuralRequestReader(node);
  const value = reader.value('childProjections');
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) {
    invalidRequest();
  }
  const projections = value.map((entry) => decodeChildProjection(entry));
  if (
    new Set(projections.map((entry) => `${entry.task}\u0000${entry.attempt}`))
      .size !== projections.length
  ) {
    invalidRequest();
  }
  return projections;
}

function decodeChildProjection(
  node: UntrustedYamlNode,
): StructuralChildProjection {
  if (!isRecord(node)) invalidRequest();
  const reader = new StructuralRequestReader(node);
  const keys = [
    'attempt',
    'expert',
    'resultPath',
    'resultSha256',
    'task',
    'viewPath',
    'viewSha256',
  ];
  if (JSON.stringify(Object.keys(node).sort()) !== JSON.stringify(keys)) {
    invalidRequest();
  }
  const task = reader.string('task');
  const expert = reader.string('expert');
  const attempt = reader.number('attempt');
  const resultPath = reader.string('resultPath');
  const resultSha256 = reader.string('resultSha256');
  const viewPath = reader.string('viewPath');
  const viewSha256 = reader.string('viewSha256');
  const expectedDirectory = `agents/${task}/attempt-${attempt}`;
  if (
    !safeIdentifier(task) ||
    !safeIdentifier(expert) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    resultPath !== `${expectedDirectory}/result.json` ||
    viewPath !== `${expectedDirectory}/view.md` ||
    !validSha(resultSha256) ||
    !validSha(viewSha256)
  ) {
    invalidRequest();
  }
  return {
    task,
    expert,
    attempt,
    resultPath,
    resultSha256,
    viewPath,
    viewSha256,
  };
}

function requiredParent(node: UntrustedYamlMap): ParentAgentAttempt {
  const reader = new StructuralRequestReader(node);
  const value = reader.value('parent');
  if (!isRecord(value)) invalidRequest();
  const parentReader = new StructuralRequestReader(value);
  const keys = ['agent', 'attempt', 'kind', 'task'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) {
    invalidRequest();
  }
  const kind = parentReader.string('kind');
  const task = parentReader.string('task');
  const agent = parentReader.string('agent');
  const attempt = parentReader.number('attempt');
  if (
    kind !== AgentAttemptParentKind.AgentAttempt ||
    !safeIdentifier(task) ||
    !safeIdentifier(agent) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    invalidRequest();
  }
  return { kind: AgentAttemptParentKind.AgentAttempt, task, agent, attempt };
}

class StructuralRequestReader {
  readonly record: UntrustedYamlMap;

  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }

  value(key: string): UntrustedYamlNode {
    const propertyRequest: UntrustedYamlPropertyArgs = {
      record: this.record,
      key,
    };
    const value = untrustedYamlProperty(propertyRequest);
    if (value.presence === UntrustedYamlPropertyPresence.Absent)
      invalidRequest();
    return value.value;
  }

  string(key: string): string {
    const value = this.value(key);
    if (typeof value !== 'string') invalidRequest();
    return value;
  }

  number(key: string): number {
    const value = this.value(key);
    if (typeof value !== 'number') invalidRequest();
    return value;
  }
}

type PathWithinRequest = { readonly path: string; readonly root: string };

function pathWithin(request: PathWithinRequest): boolean {
  return (
    request.path === request.root || request.path.startsWith(`${request.root}/`)
  );
}

function strictDescendant(request: PathWithinRequest): boolean {
  return request.path.startsWith(`${request.root}/`);
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function validSha(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}

function invalidRequest(): never {
  throw new Error('Structural expert invocation request is invalid.');
}
