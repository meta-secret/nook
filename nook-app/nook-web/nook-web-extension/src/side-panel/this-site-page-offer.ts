import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import { SidePanelAddAuthenticatorKind } from '../lib/side-panel-authenticator-setup'

/** What the panel shows under Rust's "Add 2FA from this page" offer. */
export enum ThisSitePageOfferStatus {
  Idle = 'idle',
  Pending = 'pending',
  /** The page widget runs the enrollment for the user to review. */
  Started = 'started',
  /** Nothing started on the page. */
  Missing = 'missing',
}

export class ThisSitePageOfferViews {
  private constructor() {}

  static status(kind: SidePanelAddAuthenticatorKind): ThisSitePageOfferStatus {
    switch (kind) {
      case SidePanelAddAuthenticatorKind.Started:
        return ThisSitePageOfferStatus.Started
      case SidePanelAddAuthenticatorKind.Forbidden:
      case SidePanelAddAuthenticatorKind.NonWeb:
      case SidePanelAddAuthenticatorKind.PageUnavailable:
      case SidePanelAddAuthenticatorKind.NoSetup:
      case SidePanelAddAuthenticatorKind.TabChanged:
      case SidePanelAddAuthenticatorKind.Failed:
        return ThisSitePageOfferStatus.Missing
    }
  }

  static statusKey(status: ThisSitePageOfferStatus): I18nKey {
    switch (status) {
      case ThisSitePageOfferStatus.Idle:
      case ThisSitePageOfferStatus.Pending:
      case ThisSitePageOfferStatus.Started:
        return I18N_KEYS.ExtensionActionSiteAddAuthenticatorStarted
      case ThisSitePageOfferStatus.Missing:
        return I18N_KEYS.ExtensionActionSiteAddAuthenticatorMissing
    }
  }
}
