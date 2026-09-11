import { wsconnect } from '@nats-io/nats-core';
import type { Msg, MsgCallback } from '@nats-io/nats-core';
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
  PrStewardBoundedMessageStream,
  PrStewardSubscriptionKind,
  PrStewardSubscriptionOverloadError,
  PrStewardEventObserver,
} from './pr-steward-events.ts';

type PrStewardSubscriptionCallbackArguments = Parameters<MsgCallback<Msg>>;

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
    const messages = new PrStewardBoundedMessageStream();
    const subscription = connection.subscribe(PR_STEWARD_SUBJECT, {
      callback: (
        ...[error, message]: PrStewardSubscriptionCallbackArguments
      ) => {
        if (error instanceof Error) {
          messages.terminate({
            kind: PrStewardSubscriptionKind.Failed,
            error,
          });
          return;
        }
        messages.admit({
          data: message.data,
          unsubscribe: () => subscription.unsubscribe(),
        });
      },
    });
    void connection.closed().then((error) => {
      messages.terminate(
        error instanceof Error
          ? { kind: PrStewardSubscriptionKind.Failed, error }
          : { kind: PrStewardSubscriptionKind.Closed },
      );
    });
    let stopping = false;
    let draining: Promise<void> | false = false;
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
        messages.terminate({ kind: PrStewardSubscriptionKind.Failed, error });
      },
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    completion.start();
    try {
      await new PrStewardEventObserver({
        reader,
      }).observe({
        messages,
        pullRequest: invocation.pullRequest,
        activity: (event) => completion.activity(event),
        write: (line) => {
          process.stdout.write(line);
        },
      });
      const outcome = messages.outcome();
      if (outcome.kind === PrStewardSubscriptionKind.Overloaded)
        throw new PrStewardSubscriptionOverloadError({
          pending: outcome.pending,
        });
      const closeError = await connection.closed();
      if (closeError) throw new Error('NATS connection closed unexpectedly');
      if (draining !== false) await draining;
      if (terminal.result !== false && process.exitCode !== 1)
        process.stderr.write(
          `PR Steward finished: ${terminal.result.state} ${terminal.result.url.value} head=${terminal.result.headSha} checks=${terminal.result.totalChecks} failed-checks=${terminal.result.failedChecks} unknown-conclusions=${terminal.result.unknownConclusions}\n`,
        );
    } finally {
      completion.stop();
      if (!stopping) await connection.close();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}
