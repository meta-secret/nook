import { describe, expect, test } from 'bun:test';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardNdjsonCodec,
} from '../src/pr-steward-contract.ts';
import {
  PrStewardCommandResultKind,
  PrStewardGithubFailureKind,
  PrStewardGithubFailureReader,
  PrStewardGithubFailureReadState,
} from '../src/pr-steward-github.ts';
import type { UntrustedYamlNode } from '../src/lib/guards.ts';
import type {
  PrStewardCommandRequest,
  PrStewardCommandResult,
  PrStewardCommandRunner,
  PrStewardGithubFailureRequest,
} from '../src/pr-steward-github.ts';

const HEAD = PrStewardNdjsonCodec.headSha(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
const PR = PrStewardNdjsonCodec.pullRequest(1572);
const common = {
  repository: PR_STEWARD_REPOSITORY,
  pullRequest: PR,
  headSha: HEAD,
  objectId: 42,
} as const;

class FailureReaderScenario implements PrStewardCommandRunner {
  request: PrStewardCommandRequest | false = false;
  readonly #result: PrStewardCommandResult;

  constructor(result: PrStewardCommandResult) {
    this.#result = result;
  }

  static json(value: UntrustedYamlNode): FailureReaderScenario {
    return new FailureReaderScenario({
      kind: PrStewardCommandResultKind.Success,
      stdout: JSON.stringify(value),
    });
  }

  reader(): PrStewardGithubFailureReader {
    return Reflect.construct(PrStewardGithubFailureReader, [
      { command: this },
    ]) as PrStewardGithubFailureReader;
  }

  async run(request: PrStewardCommandRequest): Promise<PrStewardCommandResult> {
    this.request = request;
    return this.#result;
  }
}

describe('bounded GitHub failure detail reader', () => {
  test('reads the exact routed workflow job and bounded steps', async () => {
    const scenario = FailureReaderScenario.json({
      id: 42,
      run_id: 41,
      head_sha: HEAD,
      name: 'Native Rust',
      status: 'completed',
      conclusion: 'failure',
      steps: [
        {
          number: 3,
          name: 'Clippy',
          status: 'completed',
          conclusion: 'failure',
        },
      ],
    });
    const result = await scenario.reader().read({
      ...common,
      kind: PrStewardGithubFailureKind.WorkflowJob,
      runId: 41,
    });
    expect(result.state).toBe(PrStewardGithubFailureReadState.Complete);
    if (result.state !== PrStewardGithubFailureReadState.Complete)
      throw new Error('expected complete job details');
    expect(Number(result.detail.objectId)).toBe(42);
    if (result.detail.kind !== PrStewardGithubFailureKind.WorkflowJob)
      throw new Error('expected workflow job details');
    expect(Number(result.detail.runId)).toBe(41);
    expect(result.detail).toMatchObject({
      kind: PrStewardGithubFailureKind.WorkflowJob,
      headSha: HEAD,
      name: 'Native Rust',
    });
    expect(String(result.detail.status)).toBe('completed');
    expect(String(result.detail.conclusion)).toBe('failure');
    expect(result.detail.steps).toHaveLength(1);
    expect(result.detail.steps[0]!.name).toBe('Clippy');
    expect(scenario.request).toEqual({
      executable: 'gh',
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '/repos/meta-secret/nook/actions/jobs/42',
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
  });

  test.each([
    {
      kind: PrStewardGithubFailureKind.CheckRun,
      endpoint: '/repos/meta-secret/nook/check-runs/42',
      value: { name: 'Policy' },
    },
    {
      kind: PrStewardGithubFailureKind.CheckSuite,
      endpoint: '/repos/meta-secret/nook/check-suites/42',
      value: { app: { name: 'GitHub Actions' } },
    },
    {
      kind: PrStewardGithubFailureKind.WorkflowRun,
      endpoint: '/repos/meta-secret/nook/actions/runs/42',
      value: { name: 'PR' },
    },
  ])('reads only the fixed routed object endpoint', async (fixture) => {
    const scenario = FailureReaderScenario.json({
      id: 42,
      head_sha: HEAD,
      status: 'completed',
      conclusion: 'failure',
      ...fixture.value,
    });
    const result = await scenario.reader().read({
      ...common,
      kind: fixture.kind,
    });
    expect(result.state).toBe(PrStewardGithubFailureReadState.Complete);
    expect(scenario.request && scenario.request.arguments.at(-1)).toBe(
      fixture.endpoint,
    );
    expect(JSON.stringify(scenario.request)).not.toContain('/pulls?');
  });

  test.each([
    { id: 43 },
    { head_sha: 'b'.repeat(40) },
    { head_sha: ` ${HEAD}` },
    { head_sha: `${HEAD} ` },
    { run_id: 43 },
    { status: 'invented' },
    { conclusion: 'invented' },
    { steps: ['malformed'] },
    {
      steps: [
        {
          number: 1,
          name: 'Build',
          status: 'invented',
          conclusion: 'invented',
        },
      ],
    },
    { steps: Array.from({ length: 101 }, () => ({})) },
  ])('rejects mismatched or malformed routed job details', async (field) => {
    const scenario = FailureReaderScenario.json({
      id: 42,
      run_id: 41,
      head_sha: HEAD,
      name: 'Native Rust',
      status: 'completed',
      conclusion: 'failure',
      steps: [],
      ...field,
    });
    expect(
      await scenario.reader().read({
        ...common,
        kind: PrStewardGithubFailureKind.WorkflowJob,
        runId: 41,
      }),
    ).toEqual({ state: PrStewardGithubFailureReadState.Mismatch });
  });

  test.each([
    { headSha: `${HEAD}/pulls` },
    { objectId: -1 },
    { pullRequest: -1 },
    { pullRequest: false },
    { kind: 'pulls' },
  ])('rejects invalid routed identities before invocation', async (field) => {
    const scenario = FailureReaderScenario.json({});
    const request = JSON.parse(
      JSON.stringify({
        ...common,
        kind: PrStewardGithubFailureKind.CheckRun,
        ...field,
      }),
    ) as PrStewardGithubFailureRequest;
    expect(await scenario.reader().read(request)).toEqual({
      state: PrStewardGithubFailureReadState.Invalid,
    });
    expect(scenario.request).toBeFalse();
  });

  test('requires the source-specific suite name and conclusion', async () => {
    const scenario = FailureReaderScenario.json({
      id: 42,
      head_sha: HEAD,
      name: 'fabricated suite',
      status: 'completed',
      conclusion: 'startup_failure',
    });
    expect(
      await scenario.reader().read({
        ...common,
        kind: PrStewardGithubFailureKind.CheckSuite,
      }),
    ).toEqual({ state: PrStewardGithubFailureReadState.Mismatch });
  });

  test.each([
    {
      kind: PrStewardCommandResultKind.Failure,
      cause: new Error('SECRET'),
    } as const,
    { kind: PrStewardCommandResultKind.Success, stdout: 'not-json' } as const,
    {
      kind: PrStewardCommandResultKind.Success,
      stdout: 'x'.repeat(2_097_153),
    } as const,
  ])('returns sanitized unavailability', async (command) => {
    const result = await new FailureReaderScenario(command).reader().read({
      ...common,
      kind: PrStewardGithubFailureKind.CheckRun,
    });
    expect(result).toEqual({
      state: PrStewardGithubFailureReadState.Unavailable,
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});
