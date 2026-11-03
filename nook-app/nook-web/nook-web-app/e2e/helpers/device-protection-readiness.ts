/** Observe a disposable login control in one browser turn. */
export function deviceProtectionButtonReady(testId: string): boolean {
  const button = document.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLButtonElement)) return false
  const style = window.getComputedStyle(button)
  return (
    button.getClientRects().length > 0 &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    !button.disabled
  )
}
