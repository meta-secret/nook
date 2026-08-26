import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  type UntrustedYamlPropertyArgs,
} from './guards.ts';

export type ValidateReviewEventsRequest = {
  readonly parsed: UntrustedYamlMap;
  readonly knownHeads: ReadonlySet<string>;
  readonly errors: string[];
};

export function validateReviewEvents(
  request: ValidateReviewEventsRequest,
): void {
  const items = reviewEvents(request.parsed);
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      request.errors.push(`review_events[${index}] must be a mapping`);
      continue;
    }
    const eventRequest: ValidateReviewEventRequest = {
      errors: request.errors,
      index,
      item,
      knownHeads: request.knownHeads,
    };
    validateReviewEvent(eventRequest);
  }
}

type ValidateReviewEventRequest = {
  readonly errors: string[];
  readonly index: number;
  readonly item: UntrustedYamlMap;
  readonly knownHeads: ReadonlySet<string>;
};

function validateReviewEvent(request: ValidateReviewEventRequest): void {
  const { errors, index, item } = request;
  const headShaRequest: PropertyRequest = { record: item, key: 'head_sha' };
  const headSha = stringProperty(headShaRequest);
  if (headSha.length === 0) {
    errors.push(`review_events[${index}].head_sha must be a non-empty string`);
  } else if (!request.knownHeads.has(headSha)) {
    errors.push(
      `review_events[${index}].head_sha must reference a delivery head`,
    );
  }
  const requestedAtRequest: EvidenceRequest = {
    errors,
    path: `review_events[${index}].requested_at`,
    record: item,
    key: 'requested_at',
  };
  const requestedAt = requiredString(requestedAtRequest);
  const requestedTimestampRequest: ValidateTimestampRequest = {
    errors,
    path: `review_events[${index}].requested_at`,
    value: requestedAt,
  };
  validateTimestamp(requestedTimestampRequest);
  const outcomeRequest: EvidenceRequest = {
    errors,
    path: `review_events[${index}].outcome`,
    record: item,
    key: 'outcome',
  };
  const outcome = requiredString(outcomeRequest);
  if (!['findings', 'clean', 'unavailable'].includes(outcome)) {
    errors.push(`review_events[${index}].outcome is invalid`);
  }
  let completedAt = '';
  if (outcome !== 'unavailable') {
    const completedAtRequest: EvidenceRequest = {
      errors,
      path: `review_events[${index}].completed_at`,
      record: item,
      key: 'completed_at',
    };
    completedAt = requiredString(completedAtRequest);
    const completedTimestampRequest: ValidateTimestampRequest = {
      errors,
      path: `review_events[${index}].completed_at`,
      value: completedAt,
    };
    validateTimestamp(completedTimestampRequest);
  }
  const reviewerRequest: EvidenceRequest = {
    errors,
    path: `review_events[${index}].reviewer`,
    record: item,
    key: 'reviewer',
  };
  requiredString(reviewerRequest);
  const findingCountRequest: EvidenceRequest = {
    errors,
    path: `review_events[${index}].finding_count`,
    record: item,
    key: 'finding_count',
  };
  const findingCount = validateNonNegativeInteger(findingCountRequest);
  if (
    (outcome === 'findings' && findingCount === 0) ||
    (outcome !== 'findings' && findingCount !== 0)
  ) {
    errors.push(
      `review_events[${index}].finding_count must match the review outcome`,
    );
  }
  const latencyRequest: EvidenceRequest = {
    errors,
    path: `review_events[${index}].latency_seconds`,
    record: item,
    key: 'latency_seconds',
  };
  const actualLatency = validateNonNegativeInteger(latencyRequest);
  const requestedRequest: PropertyRequest = { record: item, key: 'requested' };
  const requestedProperty = property(requestedRequest);
  if (typeof requestedProperty !== 'boolean') {
    errors.push(`review_events[${index}].requested must be a boolean`);
  }
  const latencyDerivationRequest: ReviewLatencyRequest = {
    completedAt,
    outcome,
    requested: requestedProperty === true,
    requestedAt,
  };
  const expectedLatency = reviewLatency(latencyDerivationRequest);
  if (actualLatency !== expectedLatency) {
    errors.push(
      `review_events[${index}].latency_seconds must match review timestamps (${expectedLatency})`,
    );
  }
}

type ReviewLatencyRequest = {
  readonly completedAt: string;
  readonly outcome: string;
  readonly requested: boolean;
  readonly requestedAt: string;
};

function reviewLatency(request: ReviewLatencyRequest): number {
  if (!request.requested || request.outcome === 'unavailable') return 0;
  const requestedTimestamp = Date.parse(request.requestedAt);
  const completedTimestamp = Date.parse(request.completedAt);
  if (Number.isNaN(requestedTimestamp) || Number.isNaN(completedTimestamp)) {
    return 0;
  }
  return Math.max(
    0,
    Math.round((completedTimestamp - requestedTimestamp) / 1000),
  );
}

type PropertyRequest = {
  readonly record: UntrustedYamlMap;
  readonly key: string;
};

function property(request: PropertyRequest): UntrustedYamlNode {
  const args: UntrustedYamlPropertyArgs = request;
  const result = untrustedYamlProperty(args);
  return result.presence === UntrustedYamlPropertyPresence.Present
    ? result.value
    : '';
}

function stringProperty(request: PropertyRequest): string {
  const value = property(request);
  return typeof value === 'string' ? value : '';
}

type EvidenceRequest = PropertyRequest & {
  readonly errors: string[];
  readonly path: string;
};

function requiredString(request: EvidenceRequest): string {
  const value = stringProperty(request);
  if (value.length === 0) {
    request.errors.push(`${request.path} must be a non-empty string`);
  }
  return value;
}

function validateNonNegativeInteger(request: EvidenceRequest): number {
  const value = property(request);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    request.errors.push(`${request.path} must be a non-negative integer`);
    return 0;
  }
  return value;
}

type ValidateTimestampRequest = {
  readonly errors: string[];
  readonly path: string;
  readonly value: string;
};

function validateTimestamp(request: ValidateTimestampRequest): void {
  if (Number.isNaN(Date.parse(request.value))) {
    request.errors.push(`${request.path} must be a timestamp`);
  }
}

function reviewEvents(parsed: UntrustedYamlMap): readonly UntrustedYamlNode[] {
  const request: PropertyRequest = { record: parsed, key: 'review_events' };
  const value = property(request);
  return Array.isArray(value) ? value : [];
}
