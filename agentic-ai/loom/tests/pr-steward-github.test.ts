import { describe, expect, test } from 'bun:test';
import {
  PR_STEWARD_REPOSITORY,
  PrStewardDecodeCode,
  PrStewardNdjsonCodec,
} from '../src/pr-steward-contract.ts';
import type {
  PrStewardHeadSha,
  PrStewardPullRequest,
} from '../src/pr-steward-contract.ts';
import {
  PrStewardCommandResultKind,
  PrStewardGithubPrReader,
  PrStewardGithubUnavailableError,
} from '../src/pr-steward-github.ts';
import type {
  PrStewardCommandRequest,
  PrStewardCommandResult,
  PrStewardCommandRunner,
} from '../src/pr-steward-github.ts';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const URL = 'https://github.com/meta-secret/nook/pull/1560';
const PULL_REQUEST = PrStewardNdjsonCodec.pullRequest(1560);

class FixtureCommand implements PrStewardCommandRunner {
  request: PrStewardCommandRequest | false = false;
  readonly #result: PrStewardCommandResult;

  constructor(request: { readonly result: PrStewardCommandResult }) {
    this.#result = request.result;
  }

  async run(request: PrStewardCommandRequest): Promise<PrStewardCommandResult> {
    this.request = request;
    return this.#result;
  }
}

describe('assigned PR GitHub reader', () => {
  test('uses one fixed bounded non-shell GET and validates exact evidence', async () => {
    const command = new FixtureCommand({
      result: {
        kind: PrStewardCommandResultKind.Success,
        stdout: JSON.stringify({
          head: { sha: HEAD },
          html_url: URL,
          state: 'open',
          merged: false,
        }),
      },
    });
    const reader = new PrStewardGithubPrReader({ command });
    expect(
      await reader.read({
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: PULL_REQUEST,
      }),
    ).toMatchObject({ headSha: HEAD, url: { value: URL } });
    expect(command.request).toEqual({
      executable: 'gh',
      arguments: [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'GET',
        '/repos/meta-secret/nook/pulls/1560',
      ],
      timeoutMilliseconds: 10_000,
      outputLimitBytes: 2_097_152,
    });
  });

  test.each([
    `{"head":{"sha":"${HEAD}"}}`,
    `{"head":{"sha":"bad"},"html_url":"${URL}"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"${URL}?query=x"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://github.com/meta-secret/nook/pull/1559"}`,
    `{"head":{"sha":"${HEAD}"},"html_url":"https://github.com:444/meta-secret/nook/pull/1560"}`,
    `SECRET${'x'.repeat(2_097_152)}`,
  ])(
    'rejects unavailable, noncanonical, or oversized evidence',
    async (stdout) => {
      const reader = new PrStewardGithubPrReader({
        command: new FixtureCommand({
          result: { kind: PrStewardCommandResultKind.Success, stdout },
        }),
      });
      await expect(
        reader.read({
          repository: PR_STEWARD_REPOSITORY,
          pullRequest: PULL_REQUEST,
        }),
      ).rejects.toThrow('Assigned pull request observation is unavailable.');
    },
  );

  test('rejects failed commands and unauthorized capabilities', async () => {
    const cause = new Error('private command detail');
    const reader = new PrStewardGithubPrReader({
      command: new FixtureCommand({
        result: { kind: PrStewardCommandResultKind.Failure, cause },
      }),
    });
    let failure: Error | false = false;
    try {
      await reader.read({
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: PULL_REQUEST,
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failure = error;
    }
    expect(failure).toBeInstanceOf(PrStewardGithubUnavailableError);
    expect(failure === false ? false : failure.cause).toBe(cause);
    await expect(
      reader.read({
        repository: 'attacker/nook' as typeof PR_STEWARD_REPOSITORY,
        pullRequest: PULL_REQUEST,
      }),
    ).rejects.toThrow('Assigned pull request observation is unavailable.');
  });

  test('keeps validated pull request and head identities opaque', async () => {
    const pullRequest: PrStewardPullRequest = PULL_REQUEST;
    const reader = new PrStewardGithubPrReader({
      command: new FixtureCommand({
        result: {
          kind: PrStewardCommandResultKind.Success,
          stdout: JSON.stringify({
            head: { sha: HEAD },
            html_url: URL,
            state: 'open',
            merged: false,
          }),
        },
      }),
    });
    const headSha: PrStewardHeadSha = (
      await reader.read({ repository: PR_STEWARD_REPOSITORY, pullRequest })
    ).headSha;
    expect(String(headSha)).toBe(HEAD);
    expect(() => PrStewardNdjsonCodec.pullRequest(0)).toThrow(
      PrStewardDecodeCode.InvalidField,
    );
    expect(() => PrStewardNdjsonCodec.headSha('invalid')).toThrow(
      PrStewardDecodeCode.InvalidField,
    );
  });
});
