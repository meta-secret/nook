import {
  UntrustedYamlPropertyPresence,
  isRecord,
  sealUntrustedYamlMap,
  untrustedYamlProperty,
  type UntrustedYamlMap,
} from './guards.ts';
import { stringProperty } from './agent-stats-github-api.ts';

type TimestampExtremaRequest = {
  readonly values: readonly string[];
};

type MergeReviewedDeliveryHeadsRequest = {
  readonly actionHeads: readonly UntrustedYamlMap[];
  readonly reviewEvents: readonly UntrustedYamlMap[];
  readonly finalHeadSha: string;
};

export type DeliveryHeadStart = {
  readonly headSha: string;
  readonly observedAt: string;
};

type ActionHeadStart = {
  readonly headSha: string;
  readonly startedAt: string;
};

type DeliveryHeadStartsRequest = {
  readonly actions: readonly ActionHeadStart[];
  readonly reviewEvents: readonly UntrustedYamlMap[];
  readonly finalHeadSha: string;
  readonly finalHeadObservedAt: string;
};

type RetainEarlierStartRequest = {
  readonly starts: Map<string, string>;
  readonly headSha: string;
  readonly observedAt: string;
};

type PropertyRequest = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

export function mergeReviewedDeliveryHeads(
  request: MergeReviewedDeliveryHeadsRequest,
): UntrustedYamlMap[] {
  const heads = [...request.actionHeads];
  const indexByHead = new Map<string, number>();
  for (const [index, head] of heads.entries()) {
    const propertyRequest: PropertyRequest = {
      record: head,
      key: 'head_sha',
    };
    indexByHead.set(property(propertyRequest), index);
  }
  for (const event of request.reviewEvents) {
    const headRequest: PropertyRequest = { record: event, key: 'head_sha' };
    const headSha = property(headRequest);
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
    const existingIndex = indexByHead.get(headSha) ?? -1;
    if (existingIndex < 0) {
      indexByHead.set(headSha, heads.length);
      heads.push(sealUntrustedYamlMap(headRecord));
      continue;
    }
    const existing = heads[existingIndex];
    if (!existing) continue;
    const observedRequest: PropertyRequest = {
      record: existing,
      key: 'first_observed_at',
    };
    if (property(observedRequest).length === 0) {
      heads[existingIndex] = sealUntrustedYamlMap(headRecord);
    }
  }
  return chronologicallySortedHeads(heads);
}

export function deliveryHeadStarts(
  request: DeliveryHeadStartsRequest,
): DeliveryHeadStart[] {
  const earliestByHead = new Map<string, string>();
  for (const action of request.actions) {
    const retainRequest: RetainEarlierStartRequest = {
      starts: earliestByHead,
      headSha: action.headSha,
      observedAt: action.startedAt,
    };
    retainEarlierStart(retainRequest);
  }
  for (const event of request.reviewEvents) {
    const headRequest: PropertyRequest = { record: event, key: 'head_sha' };
    const observedRequest: PropertyRequest = {
      record: event,
      key: 'requested_at',
    };
    const retainRequest: RetainEarlierStartRequest = {
      starts: earliestByHead,
      headSha: property(headRequest),
      observedAt: property(observedRequest),
    };
    retainEarlierStart(retainRequest);
  }
  if (request.finalHeadObservedAt.length > 0) {
    const retainRequest: RetainEarlierStartRequest = {
      starts: earliestByHead,
      headSha: request.finalHeadSha,
      observedAt: request.finalHeadObservedAt,
    };
    retainEarlierStart(retainRequest);
  }
  const unsorted = [...earliestByHead.entries()].map((entry) => ({
    headSha: entry[0],
    observedAt: entry[1],
  }));
  const sorted: DeliveryHeadStart[] = [];
  for (const candidate of unsorted) {
    let inserted = false;
    for (const [index, existing] of sorted.entries()) {
      if (candidate.observedAt < existing.observedAt) {
        sorted.splice(index, 0, candidate);
        inserted = true;
        break;
      }
    }
    if (!inserted) sorted.push(candidate);
  }
  return sorted;
}

export function gitHubCommitTimestamp(record: UntrustedYamlMap): string {
  const commitRequest = { record, key: 'commit' };
  const commitProperty = untrustedYamlProperty(commitRequest);
  if (
    commitProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(commitProperty.value)
  ) {
    return '';
  }
  const committerRequest = {
    record: commitProperty.value,
    key: 'committer',
  };
  const committerProperty = untrustedYamlProperty(committerRequest);
  if (
    committerProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !isRecord(committerProperty.value)
  ) {
    return '';
  }
  const dateRequest: PropertyRequest = {
    record: committerProperty.value,
    key: 'date',
  };
  return property(dateRequest);
}

function retainEarlierStart(request: RetainEarlierStartRequest): void {
  const existing = request.starts.get(request.headSha) ?? '';
  if (existing.length === 0 || request.observedAt < existing) {
    request.starts.set(request.headSha, request.observedAt);
  }
}

function chronologicallySortedHeads(
  heads: readonly UntrustedYamlMap[],
): UntrustedYamlMap[] {
  const sorted: UntrustedYamlMap[] = [];
  for (const head of heads) {
    const candidateRequest: PropertyRequest = {
      record: head,
      key: 'first_observed_at',
    };
    const candidateTime = property(candidateRequest);
    let inserted = false;
    for (const [index, existing] of sorted.entries()) {
      const existingRequest: PropertyRequest = {
        record: existing,
        key: 'first_observed_at',
      };
      if (candidateTime < property(existingRequest)) {
        sorted.splice(index, 0, head);
        inserted = true;
        break;
      }
    }
    if (!inserted) sorted.push(head);
  }
  return sorted;
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
