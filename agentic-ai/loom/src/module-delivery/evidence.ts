import { ModuleDeliveryTaskKind } from './domain.ts';
import { ModuleSourceAuthority } from './authority.ts';
import { PinnedDevBaseEvidenceContract } from '../lib/base-evidence.ts';
import type {
  ModuleDeliveryAdmissionState,
  ModuleDeliveryAttemptLease,
  ModuleDeliveryGenerationAuthority,
} from './admission.ts';
import type {
  ModuleDeliveryNodeV2,
  ModuleDeliveryEvidenceSynthesisNodeV2,
  ValidatedModuleDeliveryPlan,
} from './domain.ts';
import {
  MAX_MODULE_DELIVERY_ACCEPTANCE_REQUIREMENTS,
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
  MAX_MODULE_DELIVERY_EVIDENCE_HANDOFF_BYTES,
  MAX_MODULE_DELIVERY_EVIDENCE_STRING_CODE_UNITS,
} from './evidence-limits.ts';
import {
  ModuleDeliveryProviderSubmissionKind,
  ModuleDeliveryProviderResultsKind,
  type ModuleDeliveryProviderResult,
  type ModuleDeliveryProviderResults,
  type ModuleDeliveryReadOnlyEvidenceSubmission,
} from './integration-provenance.ts';

/** Validates results at the boundary where an agent result enters the scheduler. */
export class ModuleEvidenceBoundary {
  private constructor() {}

  static validateModuleDeliveryEvidenceSubmission(
    request: ModuleDeliveryEvidenceSubmissionVerification,
  ): ModuleDeliveryProviderResult {
    const { acceptedPlan, lease, submission, state } = request;
    if (
      submission.kind !== ModuleDeliveryProviderSubmissionKind.ReadOnlyEvidence
    )
      throw new Error('Evidence boundary accepts read-only results only.');
    if (
      submission.taskId !== lease.taskId ||
      submission.attempt !== lease.attempt ||
      submission.generation !== lease.generation ||
      submission.planDigest !== acceptedPlan.planDigest ||
      submission.sourceCommit !== acceptedPlan.plan.sourceCommit
    )
      throw new Error('Provider result metadata does not match its admission.');
    if (
      !Number.isSafeInteger(submission.attempt) ||
      submission.attempt < 1 ||
      !Number.isSafeInteger(submission.generation) ||
      submission.generation < 1 ||
      !/^[0-9a-f]{40}$/u.test(submission.sourceCommit) ||
      !/^[0-9a-f]{64}$/u.test(submission.planDigest) ||
      Buffer.byteLength(JSON.stringify(submission), 'utf8') >
        MAX_MODULE_DELIVERY_EVIDENCE_HANDOFF_BYTES
    )
      throw new Error(
        'Provider result exceeds its bounded transport contract.',
      );
    ModuleEvidenceBoundary.assertBoundedStrings({
      label: 'acceptance requirements',
      values: submission.acceptanceRequirements,
      maximumEntries: MAX_MODULE_DELIVERY_ACCEPTANCE_REQUIREMENTS,
      maximumCodeUnits: MAX_MODULE_DELIVERY_EVIDENCE_STRING_CODE_UNITS,
    });
    ModuleEvidenceBoundary.assertBoundedStrings({
      label: 'result entries',
      values: submission.result,
      maximumEntries: MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
      maximumCodeUnits: MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
    });
    PinnedDevBaseEvidenceContract.assertShape({
      originMainSha: submission.originMainSha,
      pinnedLocalDevSha: submission.pinnedLocalDevSha,
    });
    if (
      submission.originMainSha !== acceptedPlan.plan.originMainSha ||
      submission.pinnedLocalDevSha !== acceptedPlan.plan.pinnedLocalDevSha
    )
      throw new Error(
        'Provider result bootstrap evidence does not match the plan.',
      );
    const node = ModuleSourceAuthority.moduleDeliveryNode({
      plan: acceptedPlan,
      taskId: lease.taskId,
    });
    ModuleEvidenceBoundary.validateNodeMetadata({ node, submission });
    if (node.kind === ModuleDeliveryTaskKind.EvidenceSynthesis)
      ModuleEvidenceBoundary.validateSynthesisInputs({
        node,
        submission,
        accepted: state.acceptedProviderEvidence,
      });
    const common = {
      ...submission,
      acceptanceRequirements: Object.freeze([
        ...submission.acceptanceRequirements,
      ]),
      result: Object.freeze([...submission.result]),
    };
    return Object.freeze({
      ...common,
      providerResults: ModuleEvidenceBoundary.copyProviderResults(
        submission.providerResults,
      ),
    });
  }

  private static validateNodeMetadata(
    request: Readonly<{
      node: ModuleDeliveryNodeV2;
      submission: ModuleDeliveryProviderResult;
    }>,
  ): void {
    const { node, submission } = request;
    if (
      submission.producerTeam !== node.team ||
      submission.functionalOwner !== node.functionalOwner ||
      submission.acceptanceOwner !== node.acceptanceOwner ||
      JSON.stringify(submission.acceptanceRequirements) !==
        JSON.stringify([
          ...node.acceptance.commands.map(({ selector }) => selector),
          ...node.acceptance.evidence,
        ])
    )
      throw new Error(
        'Provider result ownership or acceptance metadata is invalid.',
      );
  }

  private static assertBoundedStrings(
    request: Readonly<{
      label: string;
      values: readonly string[];
      maximumEntries: number;
      maximumCodeUnits: number;
    }>,
  ): void {
    const { label, values, maximumEntries, maximumCodeUnits } = request;
    if (values.length > maximumEntries)
      throw new Error(`${label} exceed their bounded entry limit.`);
    if (values.some((value) => value.length > maximumCodeUnits))
      throw new Error(`${label} exceed their bounded string limit.`);
  }

  private static validateSynthesisInputs(
    request: Readonly<{
      node: ModuleDeliveryEvidenceSynthesisNodeV2;
      submission: ModuleDeliveryProviderResult;
      accepted: readonly ModuleDeliveryProviderResult[];
    }>,
  ): void {
    const { node, submission, accepted } = request;
    const expected = node.evidenceInput.expectedProducers.map(
      ({ taskId }) => taskId,
    );
    const inputs =
      submission.providerResults.kind ===
      ModuleDeliveryProviderResultsKind.Present
        ? submission.providerResults.values
        : [];
    if (inputs.length > MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES)
      throw new Error(
        'Evidence synthesis provider dependencies exceed their bound.',
      );
    for (const input of inputs)
      ModuleEvidenceBoundary.assertBoundedStrings({
        label: `provider result ${input.taskId}`,
        values: input.result,
        maximumEntries: MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
        maximumCodeUnits: MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
      });
    const available = new Map(
      [...accepted, ...inputs].map((result) => [result.taskId, result]),
    );
    if (expected.some((taskId) => !available.has(taskId)))
      throw new Error(
        'Evidence synthesis result is missing a provider dependency.',
      );
    if (new Set(inputs.map(({ taskId }) => taskId)).size !== inputs.length)
      throw new Error(
        'Evidence synthesis provider dependencies must be unique.',
      );
  }

  private static copyProviderResults(
    providerResults: ModuleDeliveryProviderResults,
  ): ModuleDeliveryProviderResults {
    if (providerResults.kind === ModuleDeliveryProviderResultsKind.None)
      return providerResults;
    return {
      kind: ModuleDeliveryProviderResultsKind.Present,
      values: Object.freeze(
        providerResults.values.map((result) =>
          Object.freeze({
            ...result,
            result: Object.freeze([...result.result]),
            providerResults: ModuleEvidenceBoundary.copyProviderResults(
              result.providerResults,
            ),
          }),
        ),
      ),
    };
  }
}

export type ModuleDeliveryEvidenceSubmissionVerification = Readonly<{
  authority?: ModuleDeliveryGenerationAuthority;
  acceptedPlan: ValidatedModuleDeliveryPlan;
  repositoryRoot?: string;
  state: ModuleDeliveryAdmissionState;
  submission: ModuleDeliveryReadOnlyEvidenceSubmission;
  lease: ModuleDeliveryAttemptLease;
}>;

export type ModuleDeliveryEvidenceSubmissionValidation = Readonly<{
  submission: ModuleDeliveryProviderResult;
}>;
