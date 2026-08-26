import { sealUntrustedYamlMap, type UntrustedYamlMap } from './guards.ts';
import { stringProperty } from './agent-stats-github-api.ts';

type TimestampExtremaRequest = {
  readonly values: readonly string[];
};

type MergeReviewedDeliveryHeadsRequest = {
  readonly actionHeads: readonly UntrustedYamlMap[];
  readonly reviewEvents: readonly UntrustedYamlMap[];
  readonly finalHeadSha: string;
};

type PropertyRequest = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

export function mergeReviewedDeliveryHeads(
  request: MergeReviewedDeliveryHeadsRequest,
): UntrustedYamlMap[] {
  const heads = [...request.actionHeads];
  const known = new Set(
    heads.map((head) => {
      const propertyRequest: PropertyRequest = {
        record: head,
        key: 'head_sha',
      };
      return property(propertyRequest);
    }),
  );
  for (const event of request.reviewEvents) {
    const headRequest: PropertyRequest = { record: event, key: 'head_sha' };
    const headSha = property(headRequest);
    if (known.has(headSha)) continue;
    const requestedRequest: PropertyRequest = {
      record: event,
      key: 'requested_at',
    };
    const requestedAt = property(requestedRequest);
    const completedRequest: PropertyRequest = {
      record: event,
      key: 'completed_at',
    };
    const completedAt = property(completedRequest);
    const timestamps = [requestedAt, completedAt].filter(
      (timestamp) => timestamp.length > 0,
    );
    const timestampRequest: TimestampExtremaRequest = { values: timestamps };
    const headRecord = {
      head_sha: headSha,
      first_observed_at: minimumTimestamp(timestampRequest),
      last_observed_at: maximumTimestamp(timestampRequest),
      final: headSha === request.finalHeadSha,
      action_run_count: 0,
      action_seconds: 0,
      obsolete_action_seconds: 0,
    };
    heads.push(sealUntrustedYamlMap(headRecord));
    known.add(headSha);
  }
  return heads;
}

export function minimumTimestamp(request: TimestampExtremaRequest): string {
  const populated = request.values.filter((value) => value.length > 0);
  if (populated.length === 0) return '';
  let minimum = populated[0] ?? '';
  for (const value of populated) if (value < minimum) minimum = value;
  return minimum;
}

export function maximumTimestamp(request: TimestampExtremaRequest): string {
  const populated = request.values.filter((value) => value.length > 0);
  if (populated.length === 0) return '';
  let maximum = populated[0] ?? '';
  for (const value of populated) if (value > maximum) maximum = value;
  return maximum;
}

function property(request: PropertyRequest): string {
  return stringProperty(request);
}
