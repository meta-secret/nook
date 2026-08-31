import {
  MAX_EXPANDED_PROVIDER_EVIDENCE_IDENTITIES,
  MAX_MODULE_DELIVERY_ARTIFACT_IDENTITY_CODE_UNITS,
  MAX_MODULE_DELIVERY_ACCEPTANCE_REQUIREMENTS,
  MAX_MODULE_DELIVERY_EVIDENCE_CLAIMS,
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
  MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
} from '../module-delivery/evidence-limits.ts';

const MAX_JSON_BYTES_PER_CODE_UNIT = 6;
const MAX_RESOURCE_CLAIM_CODE_UNITS = 4096;
const MAX_IDENTIFIER_CODE_UNITS = 64;
const MAX_PATH_CODE_UNITS = 4096;
const MAX_DIGEST_CODE_UNITS = 64;
const MAX_COMMIT_CODE_UNITS = 40;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

type JsonStringBytesRequest = Readonly<{
  codeUnits: number;
  bytesPerCodeUnit: number;
}>;
type JsonArrayBytesRequest = Readonly<{
  itemCount: number;
  itemBytes: number;
}>;

function jsonStringBytes(request: JsonStringBytesRequest): number {
  return 2 + request.codeUnits * request.bytesPerCodeUnit;
}

function jsonArrayBytes(request: JsonArrayBytesRequest): number {
  return (
    2 +
    request.itemCount * request.itemBytes +
    Math.max(0, request.itemCount - 1)
  );
}

const emptyClaimBytes = JSON.stringify({ claim: '', contentDigest: '' }).length;
const maximumClaimBytes =
  emptyClaimBytes -
  4 +
  jsonStringBytes({
    codeUnits: MAX_RESOURCE_CLAIM_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) +
  jsonStringBytes({ codeUnits: MAX_DIGEST_CODE_UNITS, bytesPerCodeUnit: 1 });
const maximumClaimsBytes = jsonArrayBytes({
  itemCount: MAX_MODULE_DELIVERY_EVIDENCE_CLAIMS,
  itemBytes: maximumClaimBytes,
});
const maximumBoundedTextBytes = jsonStringBytes({
  codeUnits: MAX_MODULE_DELIVERY_EVIDENCE_ENTRY_CODE_UNITS,
  bytesPerCodeUnit: MAX_JSON_BYTES_PER_CODE_UNIT,
});
const maximumAcceptanceBytes = jsonArrayBytes({
  itemCount: MAX_MODULE_DELIVERY_ACCEPTANCE_REQUIREMENTS,
  itemBytes: maximumBoundedTextBytes,
});
const maximumEvidenceBytes = jsonArrayBytes({
  itemCount: MAX_MODULE_DELIVERY_EVIDENCE_ENTRIES,
  itemBytes: maximumBoundedTextBytes,
});

const emptyIdentity = {
  schemaVersion: MAX_SAFE_INTEGER,
  generation: MAX_SAFE_INTEGER,
  planDigest: '',
  taskId: '',
  attempt: MAX_SAFE_INTEGER,
  producerTeam: '',
  functionalOwner: '',
  acceptanceOwner: '',
  sourceCommit: '',
  verifiedHeadCommit: '',
  artifactIdentity: '',
  artifactDigest: '',
  sourceProvenanceDigest: '',
  verdict: '',
  claimIdentities: [],
  acceptanceRequirements: [],
  acceptedProviderEvidence: [],
};
const maximumIdentityOwnBytes =
  JSON.stringify(emptyIdentity).length +
  jsonStringBytes({ codeUnits: MAX_DIGEST_CODE_UNITS, bytesPerCodeUnit: 1 }) -
  2 +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) *
    3 -
  6 +
  jsonStringBytes({ codeUnits: MAX_COMMIT_CODE_UNITS, bytesPerCodeUnit: 1 }) *
    2 -
  4 +
  jsonStringBytes({
    codeUnits: MAX_MODULE_DELIVERY_ARTIFACT_IDENTITY_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  jsonStringBytes({ codeUnits: MAX_DIGEST_CODE_UNITS, bytesPerCodeUnit: 1 }) *
    2 -
  4 +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  maximumClaimsBytes -
  2 +
  maximumAcceptanceBytes -
  2;
const maximumAncestryBytes = jsonArrayBytes({
  itemCount: MAX_EXPANDED_PROVIDER_EVIDENCE_IDENTITIES,
  itemBytes: maximumIdentityOwnBytes,
});

const emptyReadOnlyRecord = {
  kind: 'provider',
  submission: {
    kind: 'read-only-evidence',
    schemaVersion: MAX_SAFE_INTEGER,
    taskId: '',
    attempt: MAX_SAFE_INTEGER,
    generation: MAX_SAFE_INTEGER,
    planDigest: '',
    sourceCommit: '',
    producerTeam: '',
    functionalOwner: '',
    acceptanceOwner: '',
    acceptanceRequirements: [],
    claimIdentities: [],
    acceptedProviderEvidence: [],
    artifactIdentity: '',
    artifactDigest: '',
    verdict: '',
    evidence: [],
  },
};
const maximumReadOnlyRecordBytes =
  JSON.stringify(emptyReadOnlyRecord).length +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  jsonStringBytes({ codeUnits: MAX_DIGEST_CODE_UNITS, bytesPerCodeUnit: 1 }) -
  2 +
  jsonStringBytes({ codeUnits: MAX_COMMIT_CODE_UNITS, bytesPerCodeUnit: 1 }) -
  2 +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) *
    3 -
  6 +
  maximumAcceptanceBytes -
  2 +
  maximumClaimsBytes -
  2 +
  maximumAncestryBytes -
  2 +
  jsonStringBytes({
    codeUnits: MAX_MODULE_DELIVERY_ARTIFACT_IDENTITY_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  jsonStringBytes({ codeUnits: MAX_DIGEST_CODE_UNITS, bytesPerCodeUnit: 1 }) -
  2 +
  jsonStringBytes({
    codeUnits: MAX_IDENTIFIER_CODE_UNITS,
    bytesPerCodeUnit: 1,
  }) -
  2 +
  maximumEvidenceBytes -
  2;

const emptyWriteRecord = {
  kind: 'provider',
  submission: {
    kind: 'write',
    generation: MAX_SAFE_INTEGER,
    acceptedByTeam: '',
    verdict: '',
    handoff: {
      taskId: '',
      attempt: MAX_SAFE_INTEGER,
      planDigest: '',
      baselineCommit: '',
      commit: '',
      workspace: {
        sourceRepositoryRoot: '',
        ownedWorkspaceRoot: '',
        worktreePath: '',
        worktreeAdminDirectory: '',
        gitCommonDirectory: '',
        worktreeId: '',
        planDigest: '',
        taskId: '',
        attempt: MAX_SAFE_INTEGER,
        baselineCommit: '',
      },
    },
  },
};
const maximumWriteRecordBytes =
  JSON.stringify(emptyWriteRecord).length +
  8 *
    (jsonStringBytes({
      codeUnits: MAX_PATH_CODE_UNITS,
      bytesPerCodeUnit: MAX_JSON_BYTES_PER_CODE_UNIT,
    }) -
      2) +
  4 *
    (jsonStringBytes({
      codeUnits: MAX_IDENTIFIER_CODE_UNITS,
      bytesPerCodeUnit: 1,
    }) -
      2) +
  3 *
    (jsonStringBytes({
      codeUnits: MAX_DIGEST_CODE_UNITS,
      bytesPerCodeUnit: 1,
    }) -
      2) +
  3 *
    (jsonStringBytes({
      codeUnits: MAX_COMMIT_CODE_UNITS,
      bytesPerCodeUnit: 1,
    }) -
      2);

export const MAX_SERIALIZED_TEAM_PLAN_RECORD_BYTES = Math.max(
  maximumReadOnlyRecordBytes,
  maximumWriteRecordBytes,
);
export const MAX_TEAM_PLAN_RECORD_REQUEST_BYTES =
  MAX_SERIALIZED_TEAM_PLAN_RECORD_BYTES + 1;
