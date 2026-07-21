/** Full navigation so the extension content script re-scans the next page. */
export function navigate(path: string): void {
  // Yield briefly so the extension can stage a save offer before unload.
  window.setTimeout(() => {
    location.assign(path)
  }, 250)
}

export function recordLoginSubmission(email: string, password: string): void {
  ;(
    window as Window & {
      __nookLoginSubmitted?: { email: string; password: string } | null
    }
  ).__nookLoginSubmitted = { email, password }
}
