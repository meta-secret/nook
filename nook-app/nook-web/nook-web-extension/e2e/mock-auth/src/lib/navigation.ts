/** Full navigation so the extension content script re-scans the next page. */
export function navigate(path: string): void {
  location.assign(path)
}

export function recordLoginSubmission(email: string, password: string): void {
  ;(
    window as Window & {
      __nookLoginSubmitted?: { email: string; password: string } | null
    }
  ).__nookLoginSubmitted = { email, password }
}
