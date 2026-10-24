import type { I18nKey } from "../../../generated/i18n-keys";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  ExtensionConsentDeliveryOutcomeKind,
  ExtensionConsentWorkflowKind,
  type ExtensionConsentWorkflowState,
} from "./extension-connect-consent-workflow";

export enum ExtensionConsentActivityKind {
  /** Nothing runs: the consent offers its actions. */
  Idle = "idle",
  /** An approval runs until the consent closes. */
  Working = "working",
}

export enum ExtensionConsentActivitySegment {
  Done = "done",
  Current = "current",
  Pending = "pending",
}

export type ExtensionConsentActivity =
  | { readonly kind: ExtensionConsentActivityKind.Idle }
  | {
      readonly kind: ExtensionConsentActivityKind.Working;
      readonly step: number;
      readonly total: number;
      readonly translationKey: I18nKey;
    };

const EXTENSION_CONSENT_ACTIVITY_TOTAL = 4;

const idle: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Idle,
};
const authorizing: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Working,
  step: 1,
  total: EXTENSION_CONSENT_ACTIVITY_TOTAL,
  translationKey: I18N_KEYS.ExtensionConsentProgressAuthorizing,
};
const preparing: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Working,
  step: 2,
  total: EXTENSION_CONSENT_ACTIVITY_TOTAL,
  translationKey: I18N_KEYS.ExtensionConsentProgressPreparing,
};
const delivering: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Working,
  step: 3,
  total: EXTENSION_CONSENT_ACTIVITY_TOTAL,
  translationKey: I18N_KEYS.ExtensionConsentProgressDelivering,
};
const finishing: ExtensionConsentActivity = {
  kind: ExtensionConsentActivityKind.Working,
  step: 4,
  total: EXTENSION_CONSENT_ACTIVITY_TOTAL,
  translationKey: I18N_KEYS.ExtensionConsentProgressFinishing,
};

/**
 * What the consent shows while an approval runs, from the click until the
 * consent closes. This only names progress for display; the consent
 * workflow and Rust/WASM approval stay the authority.
 */
export class ExtensionConsentActivityPresentation {
  private constructor() {}

  static readonly total = EXTENSION_CONSENT_ACTIVITY_TOTAL;

  static of(state: ExtensionConsentWorkflowState): ExtensionConsentActivity {
    switch (state.kind) {
      case ExtensionConsentWorkflowKind.Resting:
      case ExtensionConsentWorkflowKind.Failed:
        return idle;
      case ExtensionConsentWorkflowKind.SubmittingAuthorization:
        return authorizing;
      case ExtensionConsentWorkflowKind.PreparingGrant:
        return preparing;
      case ExtensionConsentWorkflowKind.DeliveringGrant:
        return delivering;
      case ExtensionConsentWorkflowKind.RefreshingDevices:
        return finishing;
      // A delivered approval keeps working until the consent closes.
      case ExtensionConsentWorkflowKind.Completed:
        return state.outcome.kind ===
          ExtensionConsentDeliveryOutcomeKind.Delivered
          ? finishing
          : idle;
    }
  }

  /** One segment per step: finished steps, the running one, and the rest. */
  static segments(
    activity: ExtensionConsentActivity,
  ): readonly ExtensionConsentActivitySegment[] {
    const step =
      activity.kind === ExtensionConsentActivityKind.Working
        ? activity.step
        : 0;
    const segments: ExtensionConsentActivitySegment[] = [];
    for (
      let position = 1;
      position <= EXTENSION_CONSENT_ACTIVITY_TOTAL;
      position++
    ) {
      if (position < step) segments.push(ExtensionConsentActivitySegment.Done);
      else if (position === step)
        segments.push(ExtensionConsentActivitySegment.Current);
      else segments.push(ExtensionConsentActivitySegment.Pending);
    }
    return segments;
  }
}
