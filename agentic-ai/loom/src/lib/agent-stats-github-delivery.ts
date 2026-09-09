import { type UntrustedYamlMap, UntrustedYamlBoundary } from './guards.ts';

import { GithubActionEvidenceApi } from './agent-stats-github-api.ts';

export class ReviewedDeliveryHistory {
  private constructor(
    private readonly request: MergeReviewedDeliveryHeadsRequest,
  ) {}
  static merge(request: MergeReviewedDeliveryHeadsRequest): UntrustedYamlMap[] {
    return new ReviewedDeliveryHistory(request).execute();
  }
  private execute(): UntrustedYamlMap[] {
    const request = this.request;
    const heads = [...request.actionHeads];
    const indexByHead = new Map<string, number>();
    for (const [index, head] of heads.entries()) {
      const propertyRequest: PropertyRequest = {
        record: head,
        key: 'head_sha',
      };
      indexByHead.set(DeliveryMetadataProperty.read(propertyRequest), index);
    }
    for (const event of request.reviewEvents) {
      const headRequest: PropertyRequest = { record: event, key: 'head_sha' };
      const headSha = DeliveryMetadataProperty.read(headRequest);
      const requestedRequest: PropertyRequest = {
        record: event,
        key: 'requested_at',
      };
      const requestedAt = DeliveryMetadataProperty.read(requestedRequest);
      const completedRequest: PropertyRequest = {
        record: event,
        key: 'completed_at',
      };
      const completedAt = DeliveryMetadataProperty.read(completedRequest);
      const timestamps = [requestedAt, completedAt].filter(
        (timestamp) => timestamp.length > 0,
      );
      const timestampRequest: TimestampExtremaRequest = { values: timestamps };
      const headRecord = {
        head_sha: headSha,
        first_observed_at: EarliestTimestamp.select(timestampRequest),
        last_observed_at: LatestTimestamp.select(timestampRequest),
        final: headSha === request.finalHeadSha,
        action_run_count: 0,
        action_seconds: 0,
        obsolete_action_seconds: 0,
      };
      const [existingIndex = -1] = [indexByHead.get(headSha)];
      if (existingIndex < 0) {
        indexByHead.set(headSha, heads.length);
        heads.push(UntrustedYamlBoundary.seal(headRecord));
        continue;
      }
      const existing = heads[existingIndex];
      if (!existing) continue;
      const firstRequest: PropertyRequest = {
        record: existing,
        key: 'first_observed_at',
      };
      const lastRequest: PropertyRequest = {
        record: existing,
        key: 'last_observed_at',
      };
      const combinedRequest: TimestampExtremaRequest = {
        values: [
          DeliveryMetadataProperty.read(firstRequest),
          DeliveryMetadataProperty.read(lastRequest),
          ...timestamps,
        ],
      };
      const mergedRecord = {
        ...existing,
        first_observed_at: EarliestTimestamp.select(combinedRequest),
        last_observed_at: LatestTimestamp.select(combinedRequest),
      };
      heads[existingIndex] = UntrustedYamlBoundary.seal(mergedRecord);
    }
    return heads;
  }
}

export class DeliveryHeadTimeline {
  private constructor(private readonly request: DeliveryHeadStartsRequest) {}
  static starts(request: DeliveryHeadStartsRequest): DeliveryHeadStart[] {
    return new DeliveryHeadTimeline(request).execute();
  }
  private execute(): DeliveryHeadStart[] {
    const request = this.request;
    const earliestByHead = new Map<string, string>();
    for (const action of request.actions) {
      const retainRequest: RetainEarlierStartRequest = {
        starts: earliestByHead,
        headSha: action.headSha,
        observedAt: action.startedAt,
      };
      DeliveryStartAccumulator.retainEarlier(retainRequest);
    }
    for (const event of request.reviewEvents) {
      const headRequest: PropertyRequest = { record: event, key: 'head_sha' };
      const observedRequest: PropertyRequest = {
        record: event,
        key: 'requested_at',
      };
      const retainRequest: RetainEarlierStartRequest = {
        starts: earliestByHead,
        headSha: DeliveryMetadataProperty.read(headRequest),
        observedAt: DeliveryMetadataProperty.read(observedRequest),
      };
      DeliveryStartAccumulator.retainEarlier(retainRequest);
    }
    const unsorted = [...earliestByHead.entries()].map((entry) => ({
      headSha: entry[0],
      observedAt: entry[1],
    }));
    const orderByHead = new Map<string, number>();
    for (const [index, headSha] of request.deliveryHeadOrder.entries()) {
      orderByHead.set(headSha, index);
    }
    const sorted: DeliveryHeadStart[] = [];
    for (const candidate of unsorted) {
      let inserted = false;
      for (const [index, existing] of sorted.entries()) {
        const [candidateOrder = -1] = [orderByHead.get(candidate.headSha)];
        const [existingOrder = -1] = [orderByHead.get(existing.headSha)];
        const bothKnown = candidateOrder >= 0 && existingOrder >= 0;
        if (
          (bothKnown && candidateOrder < existingOrder) ||
          (!bothKnown && candidate.observedAt < existing.observedAt) ||
          (!bothKnown &&
            candidate.observedAt === existing.observedAt &&
            candidateOrder >= 0 &&
            existingOrder < 0)
        ) {
          sorted.splice(index, 0, candidate);
          inserted = true;
          break;
        }
      }
      if (!inserted) sorted.push(candidate);
    }
    return sorted;
  }
}

export class DeliveryStartAccumulator {
  private constructor(private readonly request: RetainEarlierStartRequest) {}
  static retainEarlier(request: RetainEarlierStartRequest): void {
    return new DeliveryStartAccumulator(request).execute();
  }
  private execute(): void {
    const request = this.request;
    const [existing = ''] = [request.starts.get(request.headSha)];
    if (existing.length === 0 || request.observedAt < existing) {
      request.starts.set(request.headSha, request.observedAt);
    }
  }
}

export class EarliestTimestamp {
  private constructor(private readonly request: TimestampExtremaRequest) {}
  static select(request: TimestampExtremaRequest): string {
    return new EarliestTimestamp(request).execute();
  }
  private execute(): string {
    const request = this.request;
    const populated = request.values.filter((value) => value.length > 0);
    if (populated.length === 0) return '';
    let [minimum = ''] = [populated[0]];
    for (const value of populated) if (value < minimum) minimum = value;
    return minimum;
  }
}

export class LatestTimestamp {
  private constructor(private readonly request: TimestampExtremaRequest) {}
  static select(request: TimestampExtremaRequest): string {
    return new LatestTimestamp(request).execute();
  }
  private execute(): string {
    const request = this.request;
    const populated = request.values.filter((value) => value.length > 0);
    if (populated.length === 0) return '';
    let [maximum = ''] = [populated[0]];
    for (const value of populated) if (value > maximum) maximum = value;
    return maximum;
  }
}

export class DeliveryMetadataProperty {
  private constructor(private readonly request: PropertyRequest) {}
  static read(request: PropertyRequest): string {
    return new DeliveryMetadataProperty(request).execute();
  }
  private execute(): string {
    const request = this.request;
    return GithubActionEvidenceApi.stringProperty(request);
  }
}

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
  readonly deliveryHeadOrder: readonly string[];
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
