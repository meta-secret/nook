import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  type UntrustedYamlPropertyArgs,
} from './guards.ts';
import { isValidationWorkflow } from './agent-stats-github-validation.ts';

export type ValidateHeadActionTotalsRequest = {
  readonly parsed: UntrustedYamlMap;
  readonly deliveryHeads: readonly UntrustedYamlNode[];
  readonly errors: string[];
};

type HeadActionTotals = {
  readonly count: number;
  readonly seconds: number;
  readonly obsoleteSeconds: number;
};

export function validateHeadActionTotals(
  request: ValidateHeadActionTotalsRequest,
): void {
  const runsArgs: UntrustedYamlPropertyArgs = {
    record: request.parsed,
    key: 'github_actions_runs',
  };
  const runsProperty = untrustedYamlProperty(runsArgs);
  const runs =
    runsProperty.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(runsProperty.value)
      ? runsProperty.value.filter(isRecord)
      : [];
  const reviewEventsArgs: UntrustedYamlPropertyArgs = {
    record: request.parsed,
    key: 'review_events',
  };
  const reviewEventsProperty = untrustedYamlProperty(reviewEventsArgs);
  const reviewEvents =
    reviewEventsProperty.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(reviewEventsProperty.value)
      ? reviewEventsProperty.value.filter(isRecord)
      : [];
  validateDeliveryHeadOrder(request);
  for (const [index, node] of request.deliveryHeads.entries()) {
    if (!isRecord(node)) continue;
    const headShaRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'head_sha',
    };
    const headSha = stringProperty(headShaRequest);
    if (headSha.length === 0) continue;
    const nextHeadRequest: NextHeadTimestampRequest = {
      currentIndex: index,
      deliveryHeads: request.deliveryHeads,
    };
    const supersededAt = nextHeadTimestamp(nextHeadRequest);
    const totalsRequest: ActionTotalsForHeadRequest = {
      headSha,
      runs,
      supersededAt,
    };
    const totals = actionTotalsForHead(totalsRequest);
    const windowRequest: ValidateHeadObservationWindowRequest = {
      errors: request.errors,
      headIndex: index,
      head: node,
      runs,
      reviewEvents,
    };
    validateHeadObservationWindow(windowRequest);
    const runCountRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'action_run_count',
    };
    const runCountComparison: CompareHeadTotalRequest = {
      actual: totals.count,
      errors: request.errors,
      expected: numberProperty(runCountRequest),
      headIndex: index,
      key: 'action_run_count',
    };
    compareHeadTotal(runCountComparison);
    const actionSecondsRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'action_seconds',
    };
    const actionSecondsComparison: CompareHeadTotalRequest = {
      actual: totals.seconds,
      errors: request.errors,
      expected: numberProperty(actionSecondsRequest),
      headIndex: index,
      key: 'action_seconds',
    };
    compareHeadTotal(actionSecondsComparison);
    const obsoleteSecondsRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'obsolete_action_seconds',
    };
    const obsoleteSecondsComparison: CompareHeadTotalRequest = {
      actual: totals.obsoleteSeconds,
      errors: request.errors,
      expected: numberProperty(obsoleteSecondsRequest),
      headIndex: index,
      key: 'obsolete_action_seconds',
    };
    compareHeadTotal(obsoleteSecondsComparison);
  }
  const cyclesRequest: ValidateValidationCyclesRequest = {
    deliveryHeads: request.deliveryHeads,
    errors: request.errors,
    parsed: request.parsed,
    runs,
  };
  validateValidationCycles(cyclesRequest);
}

function validateDeliveryHeadOrder(
  request: ValidateHeadActionTotalsRequest,
): void {
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, node] of request.deliveryHeads.entries()) {
    if (!isRecord(node)) continue;
    const timestampRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'first_observed_at',
    };
    const timestamp = Date.parse(stringProperty(timestampRequest));
    if (Number.isNaN(timestamp)) continue;
    if (timestamp <= previousTimestamp) {
      request.errors.push(
        `delivery_heads[${index}].first_observed_at must be later than the preceding delivery head`,
      );
    }
    previousTimestamp = timestamp;
  }
}

type ValidateValidationCyclesRequest = {
  readonly deliveryHeads: readonly UntrustedYamlNode[];
  readonly errors: string[];
  readonly parsed: UntrustedYamlMap;
  readonly runs: readonly UntrustedYamlMap[];
};

function validateValidationCycles(
  request: ValidateValidationCyclesRequest,
): void {
  const cyclesArgs: UntrustedYamlPropertyArgs = {
    record: request.parsed,
    key: 'validation_cycles',
  };
  const cyclesProperty = untrustedYamlProperty(cyclesArgs);
  const cycles =
    cyclesProperty.presence === UntrustedYamlPropertyPresence.Present &&
    Array.isArray(cyclesProperty.value)
      ? cyclesProperty.value
      : [];
  const expectedAttempts = new Set(
    request.runs.filter(isRequestedValidationRun).map(attemptKey),
  );
  const observedAttempts = new Set<string>();
  for (const [index, node] of cycles.entries()) {
    if (!isRecord(node)) continue;
    const runIdRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'run_id',
    };
    const attemptRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'run_attempt',
    };
    const runId = numberProperty(runIdRequest);
    const runAttempt = numberProperty(attemptRequest);
    const cycleAttemptKey = `${runId}:${runAttempt}`;
    if (observedAttempts.has(cycleAttemptKey)) {
      request.errors.push(
        `validation_cycles[${index}] duplicates PR attempt ${cycleAttemptKey}`,
      );
    }
    observedAttempts.add(cycleAttemptKey);
    const matchingRun = request.runs.find((run) => {
      const candidateIdRequest: UntrustedYamlPropertyArgs = {
        record: run,
        key: 'run_id',
      };
      const candidateAttemptRequest: UntrustedYamlPropertyArgs = {
        record: run,
        key: 'run_attempt',
      };
      return (
        isRequestedValidationRun(run) &&
        numberProperty(candidateIdRequest) === runId &&
        numberProperty(candidateAttemptRequest) === runAttempt
      );
    });
    if (!matchingRun) {
      request.errors.push(
        `validation_cycles[${index}] must match a requested validation github_actions_runs attempt`,
      );
      continue;
    }
    for (const key of [
      'head_sha',
      'started_at',
      'finished_at',
      'conclusion',
    ] as const) {
      const cycleValueRequest: UntrustedYamlPropertyArgs = {
        record: node,
        key,
      };
      const runValueRequest: UntrustedYamlPropertyArgs = {
        record: matchingRun,
        key,
      };
      if (
        stringProperty(cycleValueRequest) !== stringProperty(runValueRequest)
      ) {
        request.errors.push(
          `validation_cycles[${index}].${key} must match github_actions_runs`,
        );
      }
    }
    const durationRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'duration_seconds',
    };
    const runDurationRequest: UntrustedYamlPropertyArgs = {
      record: matchingRun,
      key: 'duration_seconds',
    };
    if (
      numberProperty(durationRequest) !== numberProperty(runDurationRequest)
    ) {
      request.errors.push(
        `validation_cycles[${index}].duration_seconds must match github_actions_runs`,
      );
    }
    const headRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'head_sha',
    };
    const headSha = stringProperty(headRequest);
    const headIndex = request.deliveryHeads.findIndex((head) => {
      if (!isRecord(head)) return false;
      const candidateRequest: UntrustedYamlPropertyArgs = {
        record: head,
        key: 'head_sha',
      };
      return stringProperty(candidateRequest) === headSha;
    });
    const nextHeadRequest: NextHeadTimestampRequest = {
      currentIndex: headIndex,
      deliveryHeads: request.deliveryHeads,
    };
    const obsoleteRequest: ObsoleteRunSecondsRequest = {
      run: matchingRun,
      supersededAt: headIndex >= 0 ? nextHeadTimestamp(nextHeadRequest) : '',
    };
    const obsoleteSecondsRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'obsolete_seconds',
    };
    if (
      numberProperty(obsoleteSecondsRequest) !==
      obsoleteRunSeconds(obsoleteRequest)
    ) {
      request.errors.push(
        `validation_cycles[${index}].obsolete_seconds must match github_actions_runs and delivery_heads`,
      );
    }
  }
  for (const expectedAttempt of expectedAttempts) {
    if (!observedAttempts.has(expectedAttempt)) {
      request.errors.push(
        `validation_cycles must include requested github_actions_runs attempt ${expectedAttempt}`,
      );
    }
  }
}

function attemptKey(run: UntrustedYamlMap): string {
  const runIdRequest: UntrustedYamlPropertyArgs = {
    record: run,
    key: 'run_id',
  };
  const attemptRequest: UntrustedYamlPropertyArgs = {
    record: run,
    key: 'run_attempt',
  };
  const runId = numberProperty(runIdRequest);
  const attempt = numberProperty(attemptRequest);
  return `${runId}:${attempt}`;
}

function isRequestedValidationRun(run: UntrustedYamlMap): boolean {
  const workflowRequest: UntrustedYamlPropertyArgs = {
    record: run,
    key: 'workflow',
  };
  const triggerRequest: UntrustedYamlPropertyArgs = {
    record: run,
    key: 'trigger',
  };
  const requestedRequest: UntrustedYamlPropertyArgs = {
    record: run,
    key: 'validation_requested',
  };
  return (
    isValidationWorkflow(stringProperty(workflowRequest)) &&
    stringProperty(triggerRequest) === 'pull_request' &&
    booleanProperty(requestedRequest)
  );
}

type ValidateHeadObservationWindowRequest = {
  readonly errors: string[];
  readonly head: UntrustedYamlMap;
  readonly headIndex: number;
  readonly reviewEvents: readonly UntrustedYamlMap[];
  readonly runs: readonly UntrustedYamlMap[];
};

function validateHeadObservationWindow(
  request: ValidateHeadObservationWindowRequest,
): void {
  const headRequest: UntrustedYamlPropertyArgs = {
    record: request.head,
    key: 'head_sha',
  };
  const headSha = stringProperty(headRequest);
  let firstObservedAt = '';
  let lastObservedAt = '';
  for (const run of request.runs) {
    const runHeadRequest: UntrustedYamlPropertyArgs = {
      record: run,
      key: 'head_sha',
    };
    if (stringProperty(runHeadRequest) !== headSha) continue;
    for (const key of ['started_at', 'finished_at'] as const) {
      const timestampRequest: UntrustedYamlPropertyArgs = { record: run, key };
      const timestamp = stringProperty(timestampRequest);
      if (
        !firstObservedAt ||
        Date.parse(timestamp) < Date.parse(firstObservedAt)
      ) {
        firstObservedAt = timestamp;
      }
      if (
        !lastObservedAt ||
        Date.parse(timestamp) > Date.parse(lastObservedAt)
      ) {
        lastObservedAt = timestamp;
      }
    }
  }
  for (const event of request.reviewEvents) {
    const eventHeadRequest: UntrustedYamlPropertyArgs = {
      record: event,
      key: 'head_sha',
    };
    if (stringProperty(eventHeadRequest) !== headSha) continue;
    for (const key of ['requested_at', 'completed_at'] as const) {
      const timestampRequest: UntrustedYamlPropertyArgs = {
        record: event,
        key,
      };
      const timestamp = stringProperty(timestampRequest);
      if (timestamp.length === 0) continue;
      if (
        !firstObservedAt ||
        Date.parse(timestamp) < Date.parse(firstObservedAt)
      ) {
        firstObservedAt = timestamp;
      }
      if (
        !lastObservedAt ||
        Date.parse(timestamp) > Date.parse(lastObservedAt)
      ) {
        lastObservedAt = timestamp;
      }
    }
  }
  for (const [key, expected] of [
    ['first_observed_at', firstObservedAt],
    ['last_observed_at', lastObservedAt],
  ] as const) {
    const propertyRequest: UntrustedYamlPropertyArgs = {
      record: request.head,
      key,
    };
    const actual = stringProperty(propertyRequest);
    if (actual !== expected) {
      request.errors.push(
        `delivery_heads[${request.headIndex}].${key} must match action and review evidence (${expected})`,
      );
    }
  }
}

type ActionTotalsForHeadRequest = {
  readonly headSha: string;
  readonly runs: readonly UntrustedYamlMap[];
  readonly supersededAt: string;
};

function actionTotalsForHead(
  request: ActionTotalsForHeadRequest,
): HeadActionTotals {
  let count = 0;
  let seconds = 0;
  let obsoleteSeconds = 0;
  for (const run of request.runs) {
    const headRequest: UntrustedYamlPropertyArgs = {
      record: run,
      key: 'head_sha',
    };
    if (stringProperty(headRequest) !== request.headSha) {
      continue;
    }
    count += 1;
    const durationRequest: UntrustedYamlPropertyArgs = {
      record: run,
      key: 'duration_seconds',
    };
    seconds += numberProperty(durationRequest);
    const obsoleteRequest: ObsoleteRunSecondsRequest = {
      run,
      supersededAt: request.supersededAt,
    };
    obsoleteSeconds += obsoleteRunSeconds(obsoleteRequest);
  }
  return { count, seconds, obsoleteSeconds };
}

type ObsoleteRunSecondsRequest = {
  readonly run: UntrustedYamlMap;
  readonly supersededAt: string;
};

function obsoleteRunSeconds(request: ObsoleteRunSecondsRequest): number {
  if (request.supersededAt.length === 0) return 0;
  const startedAtRequest: UntrustedYamlPropertyArgs = {
    record: request.run,
    key: 'started_at',
  };
  const finishedAtRequest: UntrustedYamlPropertyArgs = {
    record: request.run,
    key: 'finished_at',
  };
  const startedAt = Date.parse(stringProperty(startedAtRequest));
  const finishedAt = Date.parse(stringProperty(finishedAtRequest));
  const superseded = Date.parse(request.supersededAt);
  if (
    Number.isNaN(startedAt) ||
    Number.isNaN(finishedAt) ||
    Number.isNaN(superseded) ||
    finishedAt <= superseded
  ) {
    return 0;
  }
  return Math.max(
    0,
    Math.round((finishedAt - Math.max(startedAt, superseded)) / 1000),
  );
}

type NextHeadTimestampRequest = {
  readonly currentIndex: number;
  readonly deliveryHeads: readonly UntrustedYamlNode[];
};

function nextHeadTimestamp(request: NextHeadTimestampRequest): string {
  for (const node of request.deliveryHeads.slice(request.currentIndex + 1)) {
    if (!isRecord(node)) continue;
    const timestampRequest: UntrustedYamlPropertyArgs = {
      record: node,
      key: 'first_observed_at',
    };
    const timestamp = stringProperty(timestampRequest);
    if (timestamp.length > 0) return timestamp;
  }
  return '';
}

type CompareHeadTotalRequest = {
  readonly actual: number;
  readonly errors: string[];
  readonly expected: number;
  readonly headIndex: number;
  readonly key: string;
};

function compareHeadTotal(request: CompareHeadTotalRequest): void {
  if (request.actual === request.expected) return;
  request.errors.push(
    `delivery_heads[${request.headIndex}].${request.key} must match github_actions_runs (${request.actual})`,
  );
}

function stringProperty(request: UntrustedYamlPropertyArgs): string {
  const property = untrustedYamlProperty(request);
  return property.presence === UntrustedYamlPropertyPresence.Present &&
    typeof property.value === 'string'
    ? property.value
    : '';
}

function numberProperty(request: UntrustedYamlPropertyArgs): number {
  const property = untrustedYamlProperty(request);
  return property.presence === UntrustedYamlPropertyPresence.Present &&
    typeof property.value === 'number'
    ? property.value
    : 0;
}

function booleanProperty(request: UntrustedYamlPropertyArgs): boolean {
  const property = untrustedYamlProperty(request);
  return (
    property.presence === UntrustedYamlPropertyPresence.Present &&
    property.value === true
  );
}
