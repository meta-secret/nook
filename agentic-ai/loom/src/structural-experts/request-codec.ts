import { AgentAttemptParentKind } from '../agent-workflow/domain.ts';
import type {
  ParentAgentAttempt,
  StructuralChildProjectionAuthorization,
} from '../agent-workflow/domain.ts';
import {
  UntrustedYamlPropertyPresence,
  UntrustedYamlBoundary,
} from '../lib/guards.ts';
import type {
  UntrustedYamlMap,
  UntrustedYamlNode,
  UntrustedYamlPropertyArgs,
} from '../lib/guards.ts';
import { StructuralExpertKind, StructuralExpertCatalog } from './catalog.ts';
import { StructuralExpertContract } from './audit.ts';

/** Owns the structural expert request decoder registry and its capability transitions. */
export class StructuralExpertRequestDecoder {
  private constructor() {}
  private static readonly MAX_REQUEST_BYTES = 131_072;

  private static readonly MAX_INSTRUCTION_LENGTH = 16_384;

  static decodeStructuralExpertInvocationRequest(
    serialized: string,
  ): StructuralExpertInvocationRequest {
    if (
      Buffer.byteLength(serialized, 'utf8') >
      StructuralExpertRequestDecoder.MAX_REQUEST_BYTES
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    let node: UntrustedYamlNode;
    try {
      node = UntrustedYamlBoundary.fromHost(JSON.parse(serialized));
    } catch {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    if (!UntrustedYamlBoundary.isRecord(node))
      StructuralExpertRequestDecoder.invalidRequest();
    const reader = new StructuralRequestReader(node);
    const expert = reader.string('expert');
    const profile = StructuralExpertCatalog.structuralExpertProfile(expert);
    if (!profile) StructuralExpertRequestDecoder.invalidRequest();
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
      StructuralExpertRequestDecoder.invalidRequest();
    }
    const kind = reader.string('kind');
    if (kind !== profile.kind) StructuralExpertRequestDecoder.invalidRequest();
    const commonRequest: DecodeCommonStructuralFieldsRequest = { expert, node };
    const fields =
      StructuralExpertRequestDecoder.decodeCommonFields(commonRequest);
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
        evidencePaths:
          StructuralExpertRequestDecoder.decodeEvidencePaths(evidenceRequest),
      };
    }
    return {
      ...fields,
      kind: StructuralExpertKind.VerifiedViewSynthesis,
      childProjections:
        StructuralExpertRequestDecoder.decodeChildProjections(node),
    };
  }

  static validatedStructuralExpertInvocationRequest(
    request: StructuralExpertInvocationRequest,
  ): StructuralExpertInvocationRequest {
    return StructuralExpertRequestDecoder.decodeStructuralExpertInvocationRequest(
      JSON.stringify(request),
    );
  }

  private static decodeCommonFields(
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
    const parent = StructuralExpertRequestDecoder.requiredParent(node);
    if (
      !StructuralExpertRequestDecoder.safeIdentifier(runId) ||
      !StructuralExpertRequestDecoder.safeIdentifier(request.expert) ||
      !StructuralExpertRequestDecoder.safeIdentifier(task) ||
      !/^[0-9a-f]{40}$/u.test(sourceCommit) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      depth !== 2 ||
      (task === parent.task && attempt === parent.attempt) ||
      instruction.trim() === '' ||
      instruction.length >
        StructuralExpertRequestDecoder.MAX_INSTRUCTION_LENGTH ||
      StructuralExpertRequestDecoder.containsForbiddenControl(instruction)
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
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

  private static decodeEvidencePaths(
    request: DecodeEvidencePathsRequest,
  ): readonly string[] {
    const reader = new StructuralRequestReader(request.node);
    const value = reader.value('evidencePaths');
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    const paths = value.map((entry) => {
      if (typeof entry !== 'string')
        StructuralExpertRequestDecoder.invalidRequest();
      return entry;
    });
    if (
      new Set(paths).size !== paths.length ||
      paths.some(
        (path) =>
          !StructuralExpertContract.safeRepositoryPath(path) ||
          (!request.profileFiles.includes(path) &&
            !request.profileDescendantRoots.some((root) => {
              const pathRequest: PathWithinRequest = { path, root };
              return StructuralExpertRequestDecoder.strictDescendant(
                pathRequest,
              );
            })) ||
          request.excludedPaths.some((root) => {
            const pathRequest: PathWithinRequest = { path, root };
            return StructuralExpertRequestDecoder.pathWithin(pathRequest);
          }),
      )
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    return paths;
  }

  private static decodeChildProjections(
    node: UntrustedYamlMap,
  ): readonly StructuralChildProjection[] {
    const reader = new StructuralRequestReader(node);
    const value = reader.value('childProjections');
    if (
      !UntrustedYamlBoundary.isList(value) ||
      value.length < 2 ||
      value.length > 16
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    const projections = value.map((entry) =>
      StructuralExpertRequestDecoder.decodeChildProjection(entry),
    );
    if (
      new Set(projections.map((entry) => `${entry.task}\u0000${entry.attempt}`))
        .size !== projections.length
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    return projections;
  }

  private static decodeChildProjection(
    node: UntrustedYamlNode,
  ): StructuralChildProjection {
    if (!UntrustedYamlBoundary.isRecord(node))
      StructuralExpertRequestDecoder.invalidRequest();
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
      StructuralExpertRequestDecoder.invalidRequest();
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
      !StructuralExpertRequestDecoder.safeIdentifier(task) ||
      !StructuralExpertRequestDecoder.safeIdentifier(expert) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1 ||
      resultPath !== `${expectedDirectory}/result.json` ||
      viewPath !== `${expectedDirectory}/view.md` ||
      !StructuralExpertRequestDecoder.validSha(resultSha256) ||
      !StructuralExpertRequestDecoder.validSha(viewSha256)
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
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

  private static requiredParent(node: UntrustedYamlMap): ParentAgentAttempt {
    const reader = new StructuralRequestReader(node);
    const value = reader.value('parent');
    if (!UntrustedYamlBoundary.isRecord(value))
      StructuralExpertRequestDecoder.invalidRequest();
    const parentReader = new StructuralRequestReader(value);
    const keys = ['agent', 'attempt', 'kind', 'task'];
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    const kind = parentReader.string('kind');
    const task = parentReader.string('task');
    const agent = parentReader.string('agent');
    const attempt = parentReader.number('attempt');
    if (
      kind !== AgentAttemptParentKind.AgentAttempt ||
      !StructuralExpertRequestDecoder.safeIdentifier(task) ||
      !StructuralExpertRequestDecoder.safeIdentifier(agent) ||
      !Number.isSafeInteger(attempt) ||
      attempt < 1
    ) {
      StructuralExpertRequestDecoder.invalidRequest();
    }
    return { kind: AgentAttemptParentKind.AgentAttempt, task, agent, attempt };
  }

  private static pathWithin(request: PathWithinRequest): boolean {
    return (
      request.path === request.root ||
      request.path.startsWith(`${request.root}/`)
    );
  }

  private static strictDescendant(request: PathWithinRequest): boolean {
    return request.path.startsWith(`${request.root}/`);
  }

  private static safeIdentifier(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
  }

  private static validSha(value: string): boolean {
    return /^[0-9a-f]{64}$/u.test(value);
  }

  private static containsForbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }

  static invalidRequest(): never {
    throw new Error('Structural expert invocation request is invalid.');
  }
}

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

type DecodeCommonStructuralFieldsRequest = {
  readonly expert: string;
  readonly node: UntrustedYamlMap;
};

type DecodeEvidencePathsRequest = {
  readonly node: UntrustedYamlMap;
  readonly profileFiles: readonly string[];
  readonly profileDescendantRoots: readonly string[];
  readonly excludedPaths: readonly string[];
};

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
    const value = UntrustedYamlBoundary.property(propertyRequest);
    if (value.presence === UntrustedYamlPropertyPresence.Absent)
      StructuralExpertRequestDecoder.invalidRequest();
    return value.value;
  }

  string(key: string): string {
    const value = this.value(key);
    if (typeof value !== 'string')
      StructuralExpertRequestDecoder.invalidRequest();
    return value;
  }

  number(key: string): number {
    const value = this.value(key);
    if (typeof value !== 'number')
      StructuralExpertRequestDecoder.invalidRequest();
    return value;
  }
}

type PathWithinRequest = { readonly path: string; readonly root: string };
