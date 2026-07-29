export function resetLoginSubmission(): void {
  Reflect.deleteProperty(window, '__nookLoginSubmitted')
}

export function credentialsFromLoginSubmit(
  event: SubmitEvent,
): { username: string; password: string } | void {
  event.preventDefault()
  const form = event.currentTarget
  if (!(form instanceof HTMLFormElement)) return
  return {
    username:
      form.querySelector<HTMLInputElement>('[name="username"]')?.value ?? '',
    password:
      form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? '',
  }
}
