export type IdentityContextFocusSchedule = {
  waitForNextFrame: () => Promise<void>;
  identityContextLoading: () => boolean;
  reviewButton: () => HTMLButtonElement | false;
};

/** Restore review focus after the login identity context has remounted. */
export class IdentityContextFocusRestoration {
  private focusedReviewButton: HTMLButtonElement | false = false;
  private focusOwner: Element = document.body;

  constructor(private readonly schedule: IdentityContextFocusSchedule) {
    const initialReviewButton = schedule.reviewButton();
    switch (initialReviewButton) {
      case false:
        break;
      default:
        this.focusOwner = initialReviewButton;
    }
  }

  async restoreWhenAvailable(): Promise<void> {
    for (let frame = 0; frame < 30; frame += 1) {
      await this.schedule.waitForNextFrame();
      const activeElement = document.activeElement;
      if (
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        activeElement !== this.focusOwner
      ) {
        return;
      }
      if (this.schedule.identityContextLoading()) {
        this.focusedReviewButton = false;
        continue;
      }
      const reviewButton = this.schedule.reviewButton();
      if (!reviewButton) {
        this.focusedReviewButton = false;
        continue;
      }
      if (reviewButton !== this.focusedReviewButton) {
        reviewButton.focus();
        this.focusedReviewButton = reviewButton;
        this.focusOwner = reviewButton;
        continue;
      }
      return;
    }
  }
}
