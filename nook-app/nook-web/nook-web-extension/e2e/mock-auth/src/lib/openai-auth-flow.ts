export const OPENAI_AUTH_MOCK_USERNAME = 'alice@nook.test'

export enum OpenAiAuthMockAuthorizationTargetKind {
  Available = 'available',
  Missing = 'missing',
}

export type OpenAiAuthMockAuthorizationTarget =
  | {
      readonly kind: OpenAiAuthMockAuthorizationTargetKind.Available
      readonly url: string
    }
  | { readonly kind: OpenAiAuthMockAuthorizationTargetKind.Missing }

export enum OpenAiAuthMockTransitionKind {
  Redirect = 'redirect',
  Completed = 'completed',
  Rejected = 'rejected',
}

export type ChatGptAuthMockSubmission = {
  readonly submitter: string
  readonly email: string
  readonly alternativeActivationCount: number
  readonly authorizationTarget: OpenAiAuthMockAuthorizationTarget
}

export type OpenAiAuthMockSubmission = {
  readonly submitter: string
  readonly email: string
  readonly alternativeActivationCount: number
}

export type ChatGptAuthMockTransition =
  | {
      readonly kind: OpenAiAuthMockTransitionKind.Redirect
      readonly url: string
    }
  | { readonly kind: OpenAiAuthMockTransitionKind.Rejected }

export type OpenAiAuthMockTransition =
  | { readonly kind: OpenAiAuthMockTransitionKind.Completed }
  | { readonly kind: OpenAiAuthMockTransitionKind.Rejected }

export class OpenAiAuthMockScenario {
  static authorizationTarget(
    pageUrl: string,
  ): OpenAiAuthMockAuthorizationTarget {
    const authOrigin = new URL(pageUrl).searchParams.get('auth_origin')
    if (!authOrigin) {
      return { kind: OpenAiAuthMockAuthorizationTargetKind.Missing }
    }
    return {
      kind: OpenAiAuthMockAuthorizationTargetKind.Available,
      url: new URL('/log-in-or-create-account', authOrigin).toString(),
    }
  }

  static submitChatGpt(
    submission: ChatGptAuthMockSubmission,
  ): ChatGptAuthMockTransition {
    if (
      submission.submitter !== 'chatgpt-continue' ||
      submission.email !== OPENAI_AUTH_MOCK_USERNAME ||
      submission.alternativeActivationCount !== 0 ||
      submission.authorizationTarget.kind !==
        OpenAiAuthMockAuthorizationTargetKind.Available
    ) {
      return { kind: OpenAiAuthMockTransitionKind.Rejected }
    }
    return {
      kind: OpenAiAuthMockTransitionKind.Redirect,
      url: submission.authorizationTarget.url,
    }
  }

  static submitOpenAi(
    submission: OpenAiAuthMockSubmission,
  ): OpenAiAuthMockTransition {
    return submission.submitter === 'openai-continue' &&
      submission.email === OPENAI_AUTH_MOCK_USERNAME &&
      submission.alternativeActivationCount === 0
      ? { kind: OpenAiAuthMockTransitionKind.Completed }
      : { kind: OpenAiAuthMockTransitionKind.Rejected }
  }
}
