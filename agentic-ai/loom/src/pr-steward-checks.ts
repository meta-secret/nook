import {
  UntrustedYamlBoundary,
  UntrustedYamlPropertyPresence,
} from './lib/guards.ts';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardNdjsonCodec,
} from './pr-steward-contract.ts';
import {
  PrStewardCommandResultKind,
  PrStewardGhCommand,
  PrStewardGithubUnavailableError,
} from './pr-steward-github.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';
import type { PrStewardHeadSha, PrStewardUrl } from './pr-steward-contract.ts';
import type {
  PrStewardAssignedPrRequest,
  PrStewardCommandRunner,
} from './pr-steward-github.ts';

export enum PrStewardCompletionState {
  Monitoring = 'monitoring',
  ChecksCompleted = 'checks-completed',
  Merged = 'merged',
  Closed = 'closed',
}
export type PrStewardCompletionSnapshot = {
  readonly state: PrStewardCompletionState;
  readonly headSha: PrStewardHeadSha;
  readonly url: PrStewardUrl;
  readonly failedChecks: number;
  readonly totalChecks: number;
  readonly unknownConclusions: number;
};
export interface PrStewardCompletionReader {
  read(request: PrStewardAssignedPrRequest): Promise<PrStewardCompletionSnapshot>;
}
type CheckSummary = {
  readonly total: number;
  readonly pending: number;
  readonly failed: number;
  readonly unknown: number;
};
enum PrStewardCheckContextKind {
  CheckRun = 'checkRun',
  StatusContext = 'statusContext',
}

export class PrStewardChecksReader implements PrStewardCompletionReader {
  static readonly #query = `query($number:Int!) {
    repository(owner:"meta-secret", name:"nook") {
      pullRequest(number:$number) {
        headRefOid state url
        commits(last:1) { nodes { commit {
          oid
          statusCheckRollup { contexts {
            checkRunCount checkRunCountsByState { state count }
            statusContextCount statusContextCountsByState { state count }
          } }
        } } }
      }
    }
  }`;

  constructor(private readonly command: PrStewardCommandRunner) {}

  static create(): PrStewardChecksReader {
    return new PrStewardChecksReader(new PrStewardGhCommand());
  }

  async read(
    request: PrStewardAssignedPrRequest,
  ): Promise<PrStewardCompletionSnapshot> {
    if (
      request.repository !== PR_STEWARD_REPOSITORY ||
      !Number.isSafeInteger(request.pullRequest) || request.pullRequest <= 0
    ) throw new PrStewardGithubUnavailableError({ cause: false });
    const result = await this.command.run({
      executable: 'gh',
      arguments: [
        'api', '--hostname', 'github.com', 'graphql',
        '-f', `query=${PrStewardChecksReader.#query}`,
        '-F', `number=${request.pullRequest}`,
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
    if (result.kind !== PrStewardCommandResultKind.Success ||
      new TextEncoder().encode(result.stdout).length > 2_097_152)
      throw new PrStewardGithubUnavailableError({ cause: false });
    try {
      const parsed = UntrustedYamlBoundary.fromHost(
        JSON.parse(result.stdout) as UntrustedYamlNode,
      );
      const envelope = this.#object(parsed);
      const errors = UntrustedYamlBoundary.property({ record: envelope, key: 'errors' });
      if (errors.presence === UntrustedYamlPropertyPresence.Present)
        throw new PrStewardGithubUnavailableError({ cause: false });
      const data = this.#object(this.#field({ record: envelope, key: 'data' }));
      const repository = this.#object(this.#field({ record: data, key: 'repository' }));
      const pr = this.#object(this.#field({ record: repository, key: 'pullRequest' }));
      const head = this.#field({ record: pr, key: 'headRefOid' });
      const rawUrl = this.#field({ record: pr, key: 'url' });
      const state = this.#field({ record: pr, key: 'state' });
      const expected = `https://github.com/${PR_STEWARD_REPOSITORY}/pull/${request.pullRequest}`;
      if (typeof head !== 'string' || rawUrl !== expected ||
        (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED'))
        throw new PrStewardGithubUnavailableError({ cause: false });
      const url = PrStewardNdjsonCodec.githubUrl(rawUrl);
      if (url === false) throw new PrStewardGithubUnavailableError({ cause: false });
      const headSha = PrStewardNdjsonCodec.headSha(head);
      const commits = this.#object(this.#field({ record: pr, key: 'commits' }));
      const nodes = this.#field({ record: commits, key: 'nodes' });
      if (!Array.isArray(nodes) || nodes.length !== 1)
        throw new PrStewardGithubUnavailableError({ cause: false });
      const commit = this.#object(this.#field({ record: this.#object(nodes[0]!), key: 'commit' }));
      if (this.#field({ record: commit, key: 'oid' }) !== headSha)
        throw new PrStewardGithubUnavailableError({ cause: false });
      const summary = this.#rollup(this.#field({ record: commit, key: 'statusCheckRollup' }));
      return {
        headSha, url, failedChecks: summary.failed,
        totalChecks: summary.total, unknownConclusions: summary.unknown,
        state: state === 'MERGED' ? PrStewardCompletionState.Merged
          : state === 'CLOSED' ? PrStewardCompletionState.Closed
            : summary.total > 0 && summary.pending === 0
              ? PrStewardCompletionState.ChecksCompleted
              : PrStewardCompletionState.Monitoring,
      };
    } catch {
      throw new PrStewardGithubUnavailableError({ cause: false });
    }
  }

  #object(value: UntrustedYamlNode): UntrustedYamlMap {
    if (!UntrustedYamlBoundary.isRecord(value))
      throw new PrStewardGithubUnavailableError({ cause: false });
    return value;
  }

  #field(request: {
    readonly record: UntrustedYamlMap;
    readonly key: string;
  }): UntrustedYamlNode {
    const field = UntrustedYamlBoundary.property(request);
    if (field.presence !== UntrustedYamlPropertyPresence.Present)
      throw new PrStewardGithubUnavailableError({ cause: false });
    return field.value;
  }

  #rollup(value: UntrustedYamlNode): CheckSummary {
    if (!value && typeof value === 'object')
      return { total: 0, pending: 0, failed: 0, unknown: 0 };
    const contexts = this.#object(this.#field({ record: this.#object(value), key: 'contexts' }));
    const checks = this.#counts({
      contexts,
      kind: PrStewardCheckContextKind.CheckRun,
    });
    const statuses = this.#counts({
      contexts,
      kind: PrStewardCheckContextKind.StatusContext,
    });
    return {
      total: checks.total + statuses.total,
      pending: checks.pending + statuses.pending,
      failed: checks.failed + statuses.failed,
      unknown: checks.unknown + statuses.unknown,
    };
  }

  #counts(request: {
    readonly contexts: UntrustedYamlMap;
    readonly kind: PrStewardCheckContextKind;
  }): CheckSummary {
    const expected = this.#field({ record: request.contexts, key: `${request.kind}Count` });
    const groups = this.#field({ record: request.contexts, key: `${request.kind}CountsByState` });
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) ||
      expected < 0 || !Array.isArray(groups))
      throw new PrStewardGithubUnavailableError({ cause: false });
    let total = 0;
    let pending = 0;
    let failed = 0;
    let unknown = 0;
    const seen = new Set<string>();
    for (const group of groups) {
      const record = this.#object(group);
      const state = this.#field({ record, key: 'state' });
      const count = this.#field({ record, key: 'count' });
      if (typeof state !== 'string' || seen.has(state) ||
        typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
        throw new PrStewardGithubUnavailableError({ cause: false });
      seen.add(state);
      total += count;
      if (request.kind === PrStewardCheckContextKind.CheckRun) {
        if (['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'].includes(state)) pending += count;
        else if (['FAILURE', 'ACTION_REQUIRED', 'CANCELLED', 'STALE', 'STARTUP_FAILURE', 'TIMED_OUT'].includes(state)) failed += count;
        else if (state === 'COMPLETED') unknown += count;
        else if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state))
          throw new PrStewardGithubUnavailableError({ cause: false });
      } else {
        if (state === 'PENDING' || state === 'EXPECTED') pending += count;
        else if (state === 'FAILURE' || state === 'ERROR') failed += count;
        else if (state !== 'SUCCESS')
          throw new PrStewardGithubUnavailableError({ cause: false });
      }
    }
    if (total !== expected) throw new PrStewardGithubUnavailableError({ cause: false });
    return { total, pending, failed, unknown };
  }
}
