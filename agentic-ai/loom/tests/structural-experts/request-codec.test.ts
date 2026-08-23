import { expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { StructuralExpertKind } from '../../src/structural-experts/catalog.ts';
import { decodeStructuralExpertInvocationRequest } from '../../src/structural-experts/request-codec.ts';
import type {
  StructuralEvidenceInvocationRequest,
  StructuralSynthesisInvocationRequest,
} from '../../src/structural-experts/request-codec.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const HASH = 'a'.repeat(64);

test('decodes exact bounded repository evidence requests', () => {
  const request = evidenceRequest();
  expect(
    decodeStructuralExpertInvocationRequest(JSON.stringify(request)),
  ).toEqual(request);
  const exactFile: StructuralEvidenceInvocationRequest = {
    ...request,
    evidencePaths: ['Taskfile.yml'],
  };
  expect(
    decodeStructuralExpertInvocationRequest(JSON.stringify(exactFile)),
  ).toEqual(exactFile);
});

test('rejects depth, scope, exclusions, traversal, and extra authority', () => {
  const request = evidenceRequest();
  const depthThree = { ...request, depth: 3 };
  const outsideScope: StructuralEvidenceInvocationRequest = {
    ...request,
    evidencePaths: ['infra'],
  };
  const researchScope: StructuralEvidenceInvocationRequest = {
    ...request,
    evidencePaths: ['nook-app/nook-web/nook-web-research'],
  };
  const traversal: StructuralEvidenceInvocationRequest = {
    ...request,
    evidencePaths: ['nook-app/nook-platform/../private'],
  };
  const extended = { ...request, allowWrites: true };
  const broadRoots = [
    'nook-app/nook-platform',
    'nook-app/nook-web',
    '.task',
    '.github/workflows',
  ].map((path) => ({ ...request, evidencePaths: [path] }));
  const cortexRequest = cortexEvidenceRequest();
  const broadCortexRoots = ['.cortex', '.agents/skills'].map((path) => ({
    ...cortexRequest,
    evidencePaths: [path],
  }));

  for (const invalid of [
    depthThree,
    outsideScope,
    researchScope,
    traversal,
    extended,
    ...broadRoots,
    ...broadCortexRoots,
  ]) {
    expect(() =>
      decodeStructuralExpertInvocationRequest(JSON.stringify(invalid)),
    ).toThrow('request is invalid');
  }
});

test('makes synthesis verified-child-view-only at the request boundary', () => {
  const request = synthesisRequest();
  expect(
    decodeStructuralExpertInvocationRequest(JSON.stringify(request)),
  ).toEqual(request);

  const repositoryEscalation = {
    ...request,
    evidencePaths: ['.cortex'],
  };
  const oneChild: StructuralSynthesisInvocationRequest = {
    ...request,
    childProjections: request.childProjections.slice(0, 1),
  };
  const forgedHash: StructuralSynthesisInvocationRequest = {
    ...request,
    childProjections: [...request.childProjections.entries()].map((entry) => {
      const [index, projection] = entry;
      return index === 0 ? { ...projection, viewSha256: 'forged' } : projection;
    }),
  };
  const forgedPath: StructuralSynthesisInvocationRequest = {
    ...request,
    childProjections: [...request.childProjections.entries()].map((entry) => {
      const [index, projection] = entry;
      return index === 0
        ? { ...projection, viewPath: '../view.md' }
        : projection;
    }),
  };

  for (const invalid of [
    repositoryEscalation,
    oneChild,
    forgedHash,
    forgedPath,
  ]) {
    expect(() =>
      decodeStructuralExpertInvocationRequest(JSON.stringify(invalid)),
    ).toThrow('request is invalid');
  }
});

function evidenceRequest(): StructuralEvidenceInvocationRequest {
  return {
    kind: StructuralExpertKind.RepositoryEvidence,
    runId: 'structural-code-review',
    expert: 'code_refactoring_expert',
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect-core-structure',
    attempt: 1,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'plan-refactoring',
      agent: 'delivery-owner',
      attempt: 1,
    },
    instruction: 'Inspect cohesion without changing accepted contracts.',
    evidencePaths: ['nook-app/nook-platform/nook-core'],
  };
}

function cortexEvidenceRequest(): StructuralEvidenceInvocationRequest {
  return {
    ...evidenceRequest(),
    expert: 'cortex_refactoring_expert',
    task: 'inspect-cortex-structure',
    evidencePaths: ['.cortex/architecture/refactoring-experts.md'],
  };
}

function synthesisRequest(): StructuralSynthesisInvocationRequest {
  const codeChildRequest: ChildProjectionFixtureRequest = {
    task: 'inspect-code',
    expert: 'code_refactoring_expert',
  };
  const cortexChildRequest: ChildProjectionFixtureRequest = {
    task: 'inspect-cortex',
    expert: 'cortex_refactoring_expert',
  };
  return {
    kind: StructuralExpertKind.VerifiedViewSynthesis,
    runId: 'structural-synthesis',
    expert: 'system_coherence_synthesizer',
    sourceCommit: SOURCE_COMMIT,
    task: 'synthesize-refactoring',
    attempt: 1,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'plan-refactoring',
      agent: 'delivery-owner',
      attempt: 1,
    },
    instruction: 'Reconcile verified evidence and preserve coverage gaps.',
    childProjections: [
      childProjection(codeChildRequest),
      childProjection(cortexChildRequest),
    ],
  };
}

type ChildProjectionFixtureRequest = {
  readonly task: string;
  readonly expert: string;
};

function childProjection(request: ChildProjectionFixtureRequest) {
  return {
    task: request.task,
    expert: request.expert,
    attempt: 1,
    resultPath: `agents/${request.task}/attempt-1/result.json`,
    resultSha256: HASH,
    viewPath: `agents/${request.task}/attempt-1/view.md`,
    viewSha256: HASH,
  };
}
