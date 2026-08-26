import {
  UntrustedYamlPropertyPresence,
  isRecord,
  untrustedYamlProperty,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
  type UntrustedYamlPropertyArgs,
} from './guards.ts';

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
    validateHeadObservationWindow({
      errors: request.errors,
      headIndex: index,
      head: node,
      runs,
    });
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
    request.runs
      .filter(
        (run) => stringProperty({ record: run, key: 'workflow' }) === 'PR',
      )
      .map((run) => attemptKey(run)),
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
      const workflowRequest: UntrustedYamlPropertyArgs = {
        record: run,
        key: 'workflow',
      };
      const candidateIdRequest: UntrustedYamlPropertyArgs = {
        record: run,
        key: 'run_id',
      };
      const candidateAttemptRequest: UntrustedYamlPropertyArgs = {
        record: run,
        key: 'run_attempt',
      };
      return (
        stringProperty(workflowRequest) === 'PR' &&
        numberProperty(candidateIdRequest) === runId &&
        numberProperty(candidateAttemptRequest) === runAttempt
      );
    });
    if (!matchingRun) {
      request.errors.push(
        `validation_cycles[${index}] must match a PR github_actions_runs attempt`,
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
        `validation_cycles must include PR github_actions_runs attempt ${expectedAttempt}`,
      );
    }
  }
}

function attemptKey(run: UntrustedYamlMap): string {
  const runId = numberProperty({ record: run, key: 'run_id' });
  const attempt = numberProperty({ record: run, key: 'run_attempt' });
  return `${runId}:${attempt}`;
}

function validateHeadObservationWindow(request: {
  readonly errors: string[];
  readonly head: UntrustedYamlMap;
  readonly headIndex: number;
  readonly runs: readonly UntrustedYamlMap[];
}): void {
  const headSha = stringProperty({ record: request.head, key: 'head_sha' });
  const headRuns = request.runs.filter(
    (run) => stringProperty({ record: run, key: 'head_sha' }) === headSha,
  );
  const timestamps = headRuns.flatMap((run) => [
    stringProperty({ record: run, key: 'started_at' }),
    stringProperty({ record: run, key: 'finished_at' }),
  ]);
  const ordered = timestamps.sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  );
  for (const [key, expected] of [
    ['first_observed_at', ordered.at(0) ?? ''],
    ['last_observed_at', ordered.at(-1) ?? ''],
  ] as const) {
    const actual = stringProperty({ record: request.head, key });
    if (actual !== expected) {
      request.errors.push(
        `delivery_heads[${request.headIndex}].${key} must match github_actions_runs (${expected})`,
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
