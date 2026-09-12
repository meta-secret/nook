import { createHash, randomUUID } from 'node:crypto';

import { readFile } from 'node:fs/promises';

import { join, resolve } from 'node:path';

import type { AgentAttemptEvent } from '../../src/agent-workflow/agent-events.ts';

import type { ModuleExpertContinuation } from '../../src/agent-workflow/domain.ts';

import {
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
} from '../../src/agent-workflow/domain.ts';

import type { ModuleExpertInvocationRequest } from '../../src/module-experts/invoke.ts';

export class ModuleExpertsInvokeScenario {
  private constructor(private readonly request: string) {}

  static directRequest(runId: string): ModuleExpertInvocationRequest {
    return new ModuleExpertsInvokeScenario(runId).execute();
  }

  private execute(): ModuleExpertInvocationRequest {
    const runId = this.request;
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

  static uniqueRunId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  static moduleExpertContinuation(): ModuleExpertContinuation {
    return {
      externalApi: ['VaultService exposes typed vault operations.'],
      dependencies: [
        'nook-crypto supplies protected cryptographic primitives.',
      ],
      consumers: ['nook-wasm consumes the public Rust facade.'],
      behaviorInvariants: [
        'Vault operations preserve domain state transitions.',
      ],
      securityInvariants: [
        'Protected material never crosses the public projection.',
      ],
      compatibilityInvariants: ['The existing WASM DTO remains stable.'],
      owningTests: ['The nook-core suite owns domain behavior.'],
      focusedValidation: ['Run the focused nook-core behavior tests.'],
      risks: ['No new implementation risk was found.'],
      unresolvedDecisions: ['No unresolved decisions remain.'],
      parentActions: [
        'Use the facade contract when planning the consumer slice.',
      ],
    };
  }

  static processingRunDirectory(runId: string): string {
    return join(
      REPO_ROOT,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      runId,
    );
  }

  static async readEvents(eventsPath: string): Promise<AgentAttemptEvent[]> {
    const serialized = await readFile(eventsPath, 'utf8');
    return serialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AgentAttemptEvent);
  }

  static sha256(serialized: string): string {
    return createHash('sha256').update(serialized).digest('hex');
  }
}

export const REPO_ROOT = resolve(import.meta.dir, '../../../..');

export const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
