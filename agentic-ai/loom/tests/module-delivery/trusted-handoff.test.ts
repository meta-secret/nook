import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { AgentAttemptParentKind } from '../../src/agent-workflow/domain.ts';
import {
  ModuleDeliveryBaselineKind,
  ModuleDeliveryValidationStatus,
  ModuleDeliveryPlanDecoder,
  ModuleGenerationAuthority,
} from '../../src/module-delivery/index.ts';
import { ModuleDeliveryPlanValidationScenario } from './plan-validation.fixture.ts';
import { ModuleDeliveryWorktreeTestSupportScenario } from './worktree-test-support.ts';

const sourceRoot = join(import.meta.dir, '../../src/module-delivery');

describe('trusted in-thread module handoff boundary', () => {
  test('does not reintroduce internal capability, replay, or registry machinery', () => {
    const forbidden = [
      'WeakMap',
      'WeakSet',
      'ModuleIntegrationProvenanceRegistry',
      'ModuleIntegrationCapabilityProvenance',
      'ModuleIntegrationCapabilityAssertions',
      'restoreModuleDeliveryCanonicalEvidenceReceipt',
      'authorizedProviderEvidence',
      'CAPABILITY_MINT_AUTHORITY',
      'node:crypto',
      'createHash',
      'randomUUID',
    ];
    const obsoleteModules = [
      'admission-state.ts',
      'admission-state-capability-authorities.ts',
      'admission-state-contracts.ts',
      'integration-capabilities.ts',
      'integration-capability-provenance.ts',
      'integration-contracts.ts',
      'integration-evidence-replay.ts',
      'integration-finalization.ts',
      'integration-provenance-registry.ts',
      'integration-writer-frontiers.ts',
    ];
    for (const file of obsoleteModules)
      expect(readdirSync(sourceRoot)).not.toContain(file);
    for (const file of readdirSync(sourceRoot).filter((name) =>
      name.endsWith('.ts'),
    )) {
      const source = readFileSync(join(sourceRoot, file), 'utf8');
      const internalSource =
        file !== 'repository-snapshot.ts' && file !== 'codec-digest.ts';
      for (const term of forbidden.filter(
        (value) =>
          internalSource || !['node:crypto', 'createHash'].includes(value),
      ))
        expect(
          source,
          `${file} contains removed internal security layer ${term}`,
        ).not.toContain(term);
    }
  });

  test('reduces trusted admissions in dependency order without receipt state', () => {
    const fixture =
      ModuleDeliveryWorktreeTestSupportScenario.createGitFixture();
    try {
      const provider = ModuleDeliveryPlanValidationScenario.readOnlyNode({
        taskId: 'core-provider',
        expert: 'core_expert',
        moduleRoot: 'nook-app/nook-platform/nook-core',
        dependencies: [],
      });
      const consumer = ModuleDeliveryPlanValidationScenario.readOnlyNode({
        taskId: 'core-consumer',
        expert: 'core_expert',
        moduleRoot: 'nook-app/nook-platform/nook-core',
        dependencies: ['core-provider'],
      });
      const authored = ModuleDeliveryPlanValidationScenario.plan({
        nodes: [
          {
            ...provider,
            baseline: {
              kind: ModuleDeliveryBaselineKind.SourceCommit,
              sourceCommit: fixture.pinnedLocalDevSha,
            },
          },
          consumer,
        ],
        edgeContracts: [
          ModuleDeliveryPlanValidationScenario.edgeContract({
            providerTaskId: 'core-provider',
            consumerTaskId: 'core-consumer',
          }),
        ],
      });
      const validation = ModuleDeliveryPlanDecoder.decodeAndValidate(
        JSON.stringify({
          ...authored,
          sourceCommit: fixture.sourceCommit,
          originMainSha: fixture.originMainSha,
          pinnedLocalDevSha: fixture.pinnedLocalDevSha,
        }),
      );
      expect(validation.status).toBe(ModuleDeliveryValidationStatus.Accepted);
      if (validation.status !== ModuleDeliveryValidationStatus.Accepted) return;
      const authority =
        ModuleGenerationAuthority.createModuleDeliveryGenerationAuthority({
          acceptedPlan: validation,
          repositoryRoot: fixture.sourceRoot,
          expectedLineage: validation.plan.nodes.map((node) => ({
            taskId: node.taskId,
            parentLineage: { kind: AgentAttemptParentKind.WorkflowRoot },
          })),
        });
      const state =
        ModuleGenerationAuthority.createModuleDeliveryAdmissionState({
          authority,
          acceptedPlan: validation,
          headCommit: fixture.sourceCommit,
          integratedWriterFrontiers: [],
          acceptedEvidence: [],
        });
      const selection =
        ModuleGenerationAuthority.selectModuleDeliveryAdmissions({
          authority,
          acceptedPlan: validation,
          state,
        });
      expect(selection.admissions.map(({ taskId }) => taskId)).toEqual([
        'core-provider',
      ]);
      expect(selection.blockedTaskIds).toEqual(['core-consumer']);
      const recording =
        ModuleGenerationAuthority.recordModuleDeliveryAttemptLeases({
          authority,
          state,
          admissions: selection.admissions,
        });
      expect(recording.leases[0]?.taskId).toBe('core-provider');
      expect(Object.keys(recording.leases[0] ?? {})).not.toContain(
        'authorizedProviderEvidence',
      );
    } finally {
      ModuleDeliveryWorktreeTestSupportScenario.disposeGitFixture(fixture);
    }
  });
});
