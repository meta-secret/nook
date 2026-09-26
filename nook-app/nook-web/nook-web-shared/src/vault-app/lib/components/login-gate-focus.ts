export type IdentityContextFocusSchedule = {
  waitForNextFrame: () => Promise<void>;
  identityContextLoading: () => boolean;
  reviewButton: () => HTMLButtonElement | false;
};

/** Restore review focus after the login identity context has remounted. */
export async function focusIdentityContextWhenAvailable(
  schedule: IdentityContextFocusSchedule,
): Promise<void> {
  const initialFocusTarget = document.activeElement || document.body;
  let focusedReviewButton: HTMLButtonElement | false = false;
  for (let frame = 0; frame < 30; frame += 1) {
    await schedule.waitForNextFrame();
    const reviewButton = schedule.reviewButton();
    const activeElement = document.activeElement || document.body;
    if (
      activeElement !== document.body &&
      activeElement !== document.documentElement &&
      activeElement !== initialFocusTarget &&
      activeElement !== focusedReviewButton &&
      activeElement !== reviewButton
    ) {
      return;
    }
    if (schedule.identityContextLoading()) {
      focusedReviewButton = false;
      continue;
    }
    if (!reviewButton) {
      focusedReviewButton = false;
      continue;
    }
    if (reviewButton !== focusedReviewButton) {
      reviewButton.focus();
      focusedReviewButton = reviewButton;
      continue;
    }
    return;
  }
}
