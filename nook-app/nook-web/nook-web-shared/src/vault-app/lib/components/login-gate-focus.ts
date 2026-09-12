export type IdentityContextFocusSchedule = {
  waitForNextFrame: () => Promise<void>;
  identityContextLoading: () => boolean;
  reviewButton: () => HTMLButtonElement | false;
};

/** Restore review focus after the login identity context has remounted. */
export async function focusIdentityContextWhenAvailable(
  schedule: IdentityContextFocusSchedule,
): Promise<void> {
  let focusedReviewButton: HTMLButtonElement | false = false;
  for (let frame = 0; frame < 30; frame += 1) {
    await schedule.waitForNextFrame();
    if (schedule.identityContextLoading()) {
      focusedReviewButton = false;
      continue;
    }
    const reviewButton = schedule.reviewButton();
    if (!reviewButton) {
      focusedReviewButton = false;
      continue;
    }
    if (
      reviewButton !== focusedReviewButton ||
      document.activeElement !== reviewButton
    ) {
      reviewButton.focus();
      focusedReviewButton = reviewButton;
      continue;
    }
    return;
  }
}
