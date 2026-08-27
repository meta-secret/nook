import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import { decodeModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';
import type { ModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';
import type { WebExpertAllowedContextPath } from '../../src/module-experts/catalog.ts';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

type ExtendedModuleExpertInvocationRequest = ModuleExpertInvocationRequest & {
  readonly allowWrites: boolean;
};

describe('module expert invocation request codec', () => {
  test('decodes a bounded exact request with direct expert lineage', () => {
    const request = directRequest('module-expert-decode');
    const serialized = JSON.stringify(request);
    const expectedRequest = {
      ...request,
      selectedContextPaths: request.selectedContextPaths ?? [],
    };

    expect(decodeModuleExpertInvocationRequest(serialized)).toEqual(
      expectedRequest,
    );
  });

  test('defaults omitted non-web selected context to an empty selection', () => {
    const request = {
      runId: 'legacy-core-expert-request',
      expert: 'core_expert',
      sourceCommit: SOURCE_COMMIT,
      task: 'inspect-core-contract',
      attempt: 1,
      depth: 2,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'feature-synthesis',
        agent: 'delivery-owner',
        attempt: 1,
      },
      instruction: 'Describe the external vault API used by nook-wasm.',
    } as const;
    const expectedRequest = { ...request, selectedContextPaths: [] };

    expect(
      decodeModuleExpertInvocationRequest(JSON.stringify(request)),
    ).toEqual(expectedRequest);
  });

  test('decodes bounded exceptional depth-three lineage', () => {
    const direct = directRequest('module-expert-child');
    const request: ModuleExpertInvocationRequest = {
      ...direct,
      depth: 3,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'inspect-feature-modules',
        agent: 'module-planner',
        attempt: 2,
      },
    };
    const expectedRequest = {
      ...request,
      selectedContextPaths: request.selectedContextPaths ?? [],
    };

    expect(
      decodeModuleExpertInvocationRequest(JSON.stringify(request)),
    ).toEqual(expectedRequest);
  });

  test('preserves a canonical task-selected web context subset', () => {
    const selectedContextPaths: readonly WebExpertAllowedContextPath[] = [
      '.cortex/teams/web-dev/product-specs/browser-extension.md',
      '.github/workflows/release.yml',
      '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ];
    const request: ModuleExpertInvocationRequest = {
      ...directRequest('web-expert-selected-context'),
      expert: 'web_expert',
      selectedContextPaths,
    };
    const expectedRequest = {
      ...request,
      selectedContextPaths: request.selectedContextPaths ?? [],
    };

    expect(
      decodeModuleExpertInvocationRequest(JSON.stringify(request)),
    ).toEqual(expectedRequest);
  });

  test('rejects incomplete, unknown, duplicate, reordered, or foreign context selection', () => {
    const selectedContextPaths: readonly WebExpertAllowedContextPath[] = [
      '.cortex/teams/web-dev/product-specs/browser-extension.md',
      '.github/workflows/release.yml',
      '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ];
    const webRequest: ModuleExpertInvocationRequest = {
      ...directRequest('web-expert-invalid-context'),
      expert: 'web_expert',
      selectedContextPaths,
    };
    const invalidRequests = [
      { ...webRequest, selectedContextPaths: [selectedContextPaths[0]] },
      { ...webRequest, selectedContextPaths: ['.cortex/unknown.md'] },
      {
        ...webRequest,
        selectedContextPaths: [
          selectedContextPaths[0],
          selectedContextPaths[0],
        ],
      },
      {
        ...webRequest,
        selectedContextPaths: [...selectedContextPaths].reverse(),
      },
      {
        ...directRequest('core-expert-foreign-context'),
        selectedContextPaths: [selectedContextPaths[0]],
      },
    ];

    for (const request of invalidRequests) {
      expect(() =>
        decodeModuleExpertInvocationRequest(JSON.stringify(request)),
      ).toThrow('request is invalid');
    }
  });

  test('rejects malformed, unbounded, extended, and excessive-depth requests', () => {
    const valid = directRequest('module-expert-invalid');
    const invalidSourceRequest: ModuleExpertInvocationRequest = {
      ...valid,
      sourceCommit: 'main',
    };
    const extraFieldRequest: ExtendedModuleExpertInvocationRequest = {
      ...valid,
      allowWrites: true,
    };
    const unboundedInstructionRequest: ModuleExpertInvocationRequest = {
      ...valid,
      instruction: 'x'.repeat(16_385),
    };
    const excessiveDepthRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 4,
    };
    const workflowRootAtDepthTwoRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const workflowRootAtDepthOneRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
      parent: { kind: AgentAttemptParentKind.WorkflowRoot },
    };
    const selfParentRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: valid.task,
        agent: valid.expert,
        attempt: valid.attempt,
      },
    };
    const zeroAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      attempt: 0,
    };
    const fractionalAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      attempt: 1.5,
    };
    const childAtRootDepthRequest: ModuleExpertInvocationRequest = {
      ...valid,
      depth: 1,
    };
    const invalidParentAttemptRequest: ModuleExpertInvocationRequest = {
      ...valid,
      parent: {
        kind: AgentAttemptParentKind.AgentAttempt,
        task: 'parent-task',
        agent: 'parent-agent',
        attempt: 0,
      },
    };
    const unsafeRunRequest: ModuleExpertInvocationRequest = {
      ...valid,
      runId: '../escape',
    };
    const invalidRequests = [
      invalidSourceRequest,
      extraFieldRequest,
      unboundedInstructionRequest,
      excessiveDepthRequest,
      workflowRootAtDepthTwoRequest,
      workflowRootAtDepthOneRequest,
      selfParentRequest,
      zeroAttemptRequest,
      fractionalAttemptRequest,
      childAtRootDepthRequest,
      invalidParentAttemptRequest,
      unsafeRunRequest,
    ];

    for (const request of invalidRequests) {
      expect(() =>
        decodeModuleExpertInvocationRequest(JSON.stringify(request)),
      ).toThrow('request is invalid');
    }
  });
});

function directRequest(runId: string): ModuleExpertInvocationRequest {
  return {
    runId,
    expert: 'core_expert',
    selectedContextPaths: [],
    sourceCommit: SOURCE_COMMIT,
    task: 'inspect-core-contract',
    attempt: 1,
    depth: 2,
    parent: {
      kind: AgentAttemptParentKind.AgentAttempt,
      task: 'feature-synthesis',
      agent: 'delivery-owner',
      attempt: 1,
    },
    instruction: 'Describe the external vault API used by nook-wasm.',
  };
}
