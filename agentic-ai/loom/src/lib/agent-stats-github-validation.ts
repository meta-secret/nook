/** Owns the validation workflow history registry and its capability transitions. */
export class ValidationWorkflowHistory {
  private constructor() {}
  private static readonly VALIDATION_WORKFLOWS = new Set([
    'CI',
    'PR',
    'Rust ecosystem checks',
    'Web research',
  ]);

  static isValidationWorkflow(workflow: string): boolean {
    return ValidationWorkflowHistory.VALIDATION_WORKFLOWS.has(workflow);
  }

  static headSupersededAt(request: HeadSupersededRequest): string {
    const currentIndex = request.headStarts.findIndex(
      (head) => head.headSha === request.headSha,
    );
    if (currentIndex < 0) return '';
    let earliestDescendant = '';
    for (const descendant of request.headStarts.slice(currentIndex + 1)) {
      if (
        descendant.observedAt.length > 0 &&
        (earliestDescendant.length === 0 ||
          descendant.observedAt < earliestDescendant)
      ) {
        earliestDescendant = descendant.observedAt;
      }
    }
    return earliestDescendant;
  }

  static obsoleteRunSeconds(request: ObsoleteRunSecondsRequest): number {
    if (
      request.supersededAt.length === 0 ||
      request.run.finishedAt <= request.supersededAt
    ) {
      return 0;
    }
    const obsoleteStart = Math.max(
      Date.parse(request.run.startedAt),
      Date.parse(request.supersededAt),
    );
    const finishedAt = Date.parse(request.run.finishedAt);
    return Math.max(0, Math.round((finishedAt - obsoleteStart) / 1000));
  }
}

export type ValidationRunTiming = {
  readonly headSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
};

export type HeadSupersededRequest = {
  readonly headSha: string;
  readonly headStarts: readonly DeliveryHeadStart[];
};

export type ObsoleteRunSecondsRequest = {
  readonly run: ValidationRunTiming;
  readonly supersededAt: string;
};

import type { DeliveryHeadStart } from './agent-stats-github-delivery.ts';
