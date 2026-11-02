import type { Snippet } from "svelte";

export enum ConnectQuestionKind {
  /** Nothing is asked before Connect. */
  None = "none",
  /** A prompt is shown before Connect, which waits while it is open. */
  Asked = "asked",
}

export enum ConnectQuestionAnswer {
  Open = "open",
  Settled = "settled",
}

/** A question a host asks above a setup's Connect button. */
export type ConnectQuestion =
  | { readonly kind: ConnectQuestionKind.None }
  | {
      readonly kind: ConnectQuestionKind.Asked;
      readonly prompt: Snippet;
      readonly answer: ConnectQuestionAnswer;
    };

export type AskedConnectQuestion = {
  readonly prompt: Snippet;
  /** Whether the host still waits for the answer. */
  readonly open: boolean;
};

export class ConnectQuestions {
  static readonly NONE: ConnectQuestion = { kind: ConnectQuestionKind.None };

  static asked({ prompt, open }: AskedConnectQuestion): ConnectQuestion {
    switch (open) {
      case true:
        return {
          kind: ConnectQuestionKind.Asked,
          prompt,
          answer: ConnectQuestionAnswer.Open,
        };
      case false:
        return {
          kind: ConnectQuestionKind.Asked,
          prompt,
          answer: ConnectQuestionAnswer.Settled,
        };
    }
  }

  /** Connect waits while an asked question is open. */
  static holdsConnect(question: ConnectQuestion): boolean {
    switch (question.kind) {
      case ConnectQuestionKind.None:
        return false;
      case ConnectQuestionKind.Asked:
        return question.answer === ConnectQuestionAnswer.Open;
    }
  }
}
