/* eslint-disable nook-typed-api/no-raw-object-arguments, max-params -- This browser transport adapter preserves indexed typed policy batches across the runtime boundary. */
import type {
  AuthenticationAdvanceControlObservation,
  AuthenticationControlTransportability,
  AuthenticationDetailedPasskeyControlCandidateObservation,
  AuthenticationDisplayProgress,
  AuthenticationImplicitSubmitActuationObservation,
  AuthenticationPageObservationFacts,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import { CompanionWasmSessionMessageType } from "./companion-wasm-runtime-messages";
import {
  CompanionWasmRuntimeDeliveryKind,
  sendCompanionWasmRuntimeMessage,
  type CompanionWasmRuntimeDelivery,
} from "./companion-wasm-runtime-transport";

const MAX_COMPANION_AUTHENTICATION_POLICY_PAYLOAD_BYTES = 128 * 1024;

export type CompanionAuthenticationPolicyEvaluationRequest = {
  readonly transportability: readonly AuthenticationControlTransportability[];
  readonly advanceControls: readonly AuthenticationAdvanceControlObservation[];
  readonly passkeyCandidates: readonly AuthenticationDetailedPasskeyControlCandidateObservation[];
  readonly pageFacts: readonly AuthenticationPageObservationFacts[];
  readonly implicitSubmissions: readonly AuthenticationImplicitSubmitActuationObservation[];
};

type MutablePolicyPayload = {
  transportability: AuthenticationControlTransportability[];
  advanceControls: AuthenticationAdvanceControlObservation[];
  passkeyCandidates: AuthenticationDetailedPasskeyControlCandidateObservation[];
  pageFacts: AuthenticationPageObservationFacts[];
  implicitSubmissions: AuthenticationImplicitSubmitActuationObservation[];
};

type PolicyPayloadBatch = {
  payload: MutablePolicyPayload;
  transportabilityIndices: number[];
  advanceControlIndices: number[];
  passkeyCandidateIndices: number[];
  pageFactsIndices: number[];
  implicitSubmissionIndices: number[];
};

enum PolicyPayloadEntryKind {
  Transportability = "transportability",
  AdvanceControl = "advanceControl",
  PasskeyCandidate = "passkeyCandidate",
  PageFacts = "pageFacts",
  ImplicitSubmission = "implicitSubmission",
}

type PolicyPayloadEntry =
  | {
      kind: PolicyPayloadEntryKind.Transportability;
      index: number;
      value: AuthenticationControlTransportability;
    }
  | {
      kind: PolicyPayloadEntryKind.AdvanceControl;
      index: number;
      value: AuthenticationAdvanceControlObservation;
    }
  | {
      kind: PolicyPayloadEntryKind.PasskeyCandidate;
      index: number;
      value: AuthenticationDetailedPasskeyControlCandidateObservation;
    }
  | {
      kind: PolicyPayloadEntryKind.PageFacts;
      index: number;
      value: AuthenticationPageObservationFacts;
    }
  | {
      kind: PolicyPayloadEntryKind.ImplicitSubmission;
      index: number;
      value: AuthenticationImplicitSubmitActuationObservation;
    };

function emptyPolicyPayloadBatch(): PolicyPayloadBatch {
  return {
    payload: {
      transportability: [],
      advanceControls: [],
      passkeyCandidates: [],
      pageFacts: [],
      implicitSubmissions: [],
    },
    transportabilityIndices: [],
    advanceControlIndices: [],
    passkeyCandidateIndices: [],
    pageFactsIndices: [],
    implicitSubmissionIndices: [],
  };
}

function policyPayloadBatchIsEmpty(batch: PolicyPayloadBatch): boolean {
  const payload = batch.payload;
  return (
    payload.transportability.length === 0 &&
    payload.advanceControls.length === 0 &&
    payload.passkeyCandidates.length === 0 &&
    payload.pageFacts.length === 0 &&
    payload.implicitSubmissions.length === 0
  );
}

function policyPayloadBytes(payload: MutablePolicyPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function appendPolicyPayloadEntry(
  batch: PolicyPayloadBatch,
  entry: PolicyPayloadEntry,
): boolean {
  switch (entry.kind) {
    case PolicyPayloadEntryKind.Transportability:
      batch.payload.transportability.push(entry.value);
      batch.transportabilityIndices.push(entry.index);
      break;
    case PolicyPayloadEntryKind.AdvanceControl:
      batch.payload.advanceControls.push(entry.value);
      batch.advanceControlIndices.push(entry.index);
      break;
    case PolicyPayloadEntryKind.PasskeyCandidate:
      batch.payload.passkeyCandidates.push(entry.value);
      batch.passkeyCandidateIndices.push(entry.index);
      break;
    case PolicyPayloadEntryKind.PageFacts:
      batch.payload.pageFacts.push(entry.value);
      batch.pageFactsIndices.push(entry.index);
      break;
    case PolicyPayloadEntryKind.ImplicitSubmission:
      batch.payload.implicitSubmissions.push(entry.value);
      batch.implicitSubmissionIndices.push(entry.index);
  }
  if (
    policyPayloadBytes(batch.payload) <=
    MAX_COMPANION_AUTHENTICATION_POLICY_PAYLOAD_BYTES
  ) {
    return true;
  }
  switch (entry.kind) {
    case PolicyPayloadEntryKind.Transportability:
      batch.payload.transportability.pop();
      batch.transportabilityIndices.pop();
      break;
    case PolicyPayloadEntryKind.AdvanceControl:
      batch.payload.advanceControls.pop();
      batch.advanceControlIndices.pop();
      break;
    case PolicyPayloadEntryKind.PasskeyCandidate:
      batch.payload.passkeyCandidates.pop();
      batch.passkeyCandidateIndices.pop();
      break;
    case PolicyPayloadEntryKind.PageFacts:
      batch.payload.pageFacts.pop();
      batch.pageFactsIndices.pop();
      break;
    case PolicyPayloadEntryKind.ImplicitSubmission:
      batch.payload.implicitSubmissions.pop();
      batch.implicitSubmissionIndices.pop();
  }
  return false;
}

function policyPayloadEntries(
  request: CompanionAuthenticationPolicyEvaluationRequest,
): PolicyPayloadEntry[] {
  return [
    ...request.transportability.map((value, index): PolicyPayloadEntry => ({
      kind: PolicyPayloadEntryKind.Transportability,
      index,
      value,
    })),
    ...request.advanceControls.map((value, index): PolicyPayloadEntry => ({
      kind: PolicyPayloadEntryKind.AdvanceControl,
      index,
      value,
    })),
    ...request.passkeyCandidates.map((value, index): PolicyPayloadEntry => ({
      kind: PolicyPayloadEntryKind.PasskeyCandidate,
      index,
      value,
    })),
    ...request.pageFacts.map((value, index): PolicyPayloadEntry => ({
      kind: PolicyPayloadEntryKind.PageFacts,
      index,
      value,
    })),
    ...request.implicitSubmissions.map((value, index): PolicyPayloadEntry => ({
      kind: PolicyPayloadEntryKind.ImplicitSubmission,
      index,
      value,
    })),
  ];
}

function policyPayloadBatches(
  request: CompanionAuthenticationPolicyEvaluationRequest,
): PolicyPayloadBatch[] {
  const batches: PolicyPayloadBatch[] = [];
  let batch = emptyPolicyPayloadBatch();
  for (const entry of policyPayloadEntries(request)) {
    if (appendPolicyPayloadEntry(batch, entry)) continue;
    if (!policyPayloadBatchIsEmpty(batch)) batches.push(batch);
    batch = emptyPolicyPayloadBatch();
    // An individually oversized untrusted entry is omitted and fails closed.
    void appendPolicyPayloadEntry(batch, entry);
  }
  if (!policyPayloadBatchIsEmpty(batch) || batches.length === 0) {
    batches.push(batch);
  }
  return batches;
}

export async function evaluateCompanionAuthenticationPolicies(
  browser: typeof globalThis,
  request: CompanionAuthenticationPolicyEvaluationRequest,
): Promise<CompanionWasmRuntimeDelivery> {
  const transportability = request.transportability.map(() => false);
  const advanceControls = request.advanceControls.map(() => false);
  const passkeyCandidates = request.passkeyCandidates.map(() => false);
  const pageFactsPriorities = request.pageFacts.map(() => 0);
  const pageFactsAdmissibility = request.pageFacts.map(() => false);
  const implicitSubmissions = request.implicitSubmissions.map(() => false);
  let activityProgress: readonly AuthenticationDisplayProgress[] = [];
  let delivered = false;
  for (const batch of policyPayloadBatches(request)) {
    const delivery = await sendCompanionWasmRuntimeMessage(browser, {
      type: CompanionWasmSessionMessageType.EvaluateAuthenticationPolicies,
      payload: batch.payload,
      origin: browser.location.origin,
    });
    if (
      delivery.kind !== CompanionWasmRuntimeDeliveryKind.Delivered ||
      !delivery.response ||
      typeof delivery.response !== "object" ||
      !("transportability" in delivery.response) ||
      !("advanceControls" in delivery.response) ||
      !("passkeyCandidates" in delivery.response) ||
      !("pageFactsPriorities" in delivery.response) ||
      !("pageFactsAdmissibility" in delivery.response) ||
      !("activityProgress" in delivery.response) ||
      !("implicitSubmissions" in delivery.response)
    ) {
      continue;
    }
    delivered = true;
    const response = delivery.response;
    if (activityProgress.length === 0)
      activityProgress = response.activityProgress;
    batch.transportabilityIndices.forEach((target, index) => {
      transportability[target] = response.transportability[index] === true;
    });
    batch.advanceControlIndices.forEach((target, index) => {
      advanceControls[target] = response.advanceControls[index] === true;
    });
    batch.passkeyCandidateIndices.forEach((target, index) => {
      passkeyCandidates[target] = response.passkeyCandidates[index] === true;
    });
    batch.pageFactsIndices.forEach((target, index) => {
      const priority = response.pageFactsPriorities[index];
      pageFactsPriorities[target] = typeof priority === "number" ? priority : 0;
      pageFactsAdmissibility[target] =
        response.pageFactsAdmissibility[index] === true;
    });
    batch.implicitSubmissionIndices.forEach((target, index) => {
      implicitSubmissions[target] =
        response.implicitSubmissions[index] === true;
    });
  }
  return delivered
    ? {
        kind: CompanionWasmRuntimeDeliveryKind.Delivered,
        response: {
          transportability,
          advanceControls,
          passkeyCandidates,
          pageFactsPriorities,
          pageFactsAdmissibility,
          activityProgress,
          implicitSubmissions,
        },
      }
    : { kind: CompanionWasmRuntimeDeliveryKind.Unavailable };
}
