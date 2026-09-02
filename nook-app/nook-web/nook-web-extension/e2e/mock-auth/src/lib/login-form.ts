export function resetLoginSubmission(): void {
  Reflect.deleteProperty(window, '__nookLoginSubmitted')
}

export enum LoginSubmissionKind {
  InvalidTarget = 'invalid-target',
  Credentials = 'credentials',
}

export type LoginSubmission =
  | { kind: LoginSubmissionKind.InvalidTarget }
  | {
      kind: LoginSubmissionKind.Credentials
      username: string
      password: string
    }

export function credentialsFromLoginSubmit(
  event: SubmitEvent,
): LoginSubmission {
  event.preventDefault()
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) {
    return { kind: LoginSubmissionKind.InvalidTarget }
  }
  return {
    kind: LoginSubmissionKind.Credentials,
    username: ((v) => (v ? v : ''))(
      form.querySelector<HTMLInputElement>('[name="username"]')?.value,
    ),
    password: ((v) => (v ? v : ''))(
      form.querySelector<HTMLInputElement>('[name="password"]')?.value,
    ),
  }
}
