export function resetLoginSubmission(): void {
  Reflect.deleteProperty(window, '__nookLoginSubmitted')
}

export function credentialsFromLoginSubmit(
  event: SubmitEvent,
): { username: string; password: string } | undefined {
  event.preventDefault()
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) return undefined
  return {
    username:
      form.querySelector<HTMLInputElement>('[name="username"]')?.value ?? '',
    password:
      form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? '',
  }
}
