import { wsconnect } from '@nats-io/nats-core';
import { PR_STEWARD_REPOSITORY } from './pr-steward-contract.ts';
import { PrStewardGithubPrReader } from './pr-steward-github.ts';
import { PrStewardChecksReader } from './pr-steward-checks.ts';
import type { PrStewardCompletionSnapshot } from './pr-steward-checks.ts';
import { PrStewardCompletion } from './pr-steward-completion.ts';
import { PrStewardInvocationCodec } from './pr-steward-invocation.ts';
import {
  PR_STEWARD_ENDPOINT,
  PR_STEWARD_SUBJECT,
  PrStewardCredentialFile,
  PrStewardEventObserver,
} from './pr-steward-events.ts';

enum PrStewardCompletionFailureKind {
  None = 'none',
  Failed = 'failed',
}
type PrStewardCompletionFailureOutcome =
  | { readonly kind: PrStewardCompletionFailureKind.None }
  | {
      readonly kind: PrStewardCompletionFailureKind.Failed;
      readonly error: Error;
    };

class PrStewardCompletionFailure {
  #outcome: PrStewardCompletionFailureOutcome = {
    kind: PrStewardCompletionFailureKind.None,
  };

  record(error: Error): void {
    this.#outcome = {
      kind: PrStewardCompletionFailureKind.Failed,
      error,
    };
  }

  read(): PrStewardCompletionFailureOutcome {
    return this.#outcome;
  }
}

export class PrStewardEventCli {
  private constructor(private readonly request: readonly string[]) {}

  static main(arguments_: readonly string[] = process.argv): Promise<void> {
    return new PrStewardEventCli(arguments_).execute();
  }

  private async execute(): Promise<void> {
    const arguments_ = this.request;
    const invocation = PrStewardInvocationCodec.parse(arguments_.slice(2));
    const credential = PrStewardCredentialFile.load(invocation.credentialPath);
    const connection = await wsconnect({
      servers: PR_STEWARD_ENDPOINT,
      user: credential.username,
      pass: credential.password,
      name: `pr-steward-${process.pid}`,
      ignoreClusterUpdates: true,
    });
    let stopping = false;
    let draining: Promise<void> | false = false;
    const completionFailure = new PrStewardCompletionFailure();
    const terminal: { result: PrStewardCompletionSnapshot | false } = {
      result: false,
    };
    const reader = PrStewardGithubPrReader.create();
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      completion.stop();
      draining = connection.drain().catch(() => {
        process.exitCode = 1;
      });
    };
    const completion = new PrStewardCompletion({
      reader: PrStewardChecksReader.create(),
      target: {
        repository: PR_STEWARD_REPOSITORY,
        pullRequest: invocation.pullRequest,
      },
      finished: (result) => {
        terminal.result = result;
        stop();
      },
      failed: (error) => {
        completionFailure.record(error);
        stop();
      },
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    completion.start();
    try {
      await new PrStewardEventObserver({
        reader,
      }).observeSubscription({
        connection,
        subject: PR_STEWARD_SUBJECT,
        pullRequest: invocation.pullRequest,
        activity: (event) => completion.activity(event),
        write: (line) => {
          process.stdout.write(line);
        },
      });
      const closeError = await connection.closed();
      if (draining !== false) await draining;
      const completionOutcome = completionFailure.read();
      if (completionOutcome.kind === PrStewardCompletionFailureKind.Failed)
        throw completionOutcome.error;
      if (closeError) throw new Error('NATS connection closed unexpectedly');
      if (terminal.result !== false && process.exitCode !== 1)
        process.stderr.write(
          `PR Lifecycle Agent finished: ${terminal.result.state} ${terminal.result.url.value} head=${terminal.result.headSha} checks=${terminal.result.totalChecks} failed-checks=${terminal.result.failedChecks} unknown-conclusions=${terminal.result.unknownConclusions}\n`,
        );
    } finally {
      completion.stop();
      if (!stopping) await connection.close();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
