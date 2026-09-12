export type IdentityContextFocusSchedule = {
  waitForNextFrame: () => Promise<void>
  identityContextLoading: () => boolean
  reviewButton: () => HTMLButtonElement | undefined
}

/** Restore review focus after the login identity context has remounted. */
export async function focusIdentityContextWhenAvailable(
  schedule: IdentityContextFocusSchedule,
): Promise<void> {
  for (let frame = 0; frame < 30; frame += 1) {
    await schedule.waitForNextFrame()
    if (schedule.identityContextLoading()) continue
    const reviewButton = schedule.reviewButton()
    if (reviewButton) {
      reviewButton.focus()
      return
    }
  }
}
