import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'

/** The extension context a session request came from. */
export enum ExtensionSessionSenderKind {
  ServiceWorker = 'service-worker',
  ExtensionPage = 'extension-page',
  Other = 'other',
}

/** Who legitimately sends a session request type. */
export enum ExtensionSessionRequestAudience {
  /** Only the service worker, after its sender-bound origin and grant checks. */
  ServiceWorker = 'service-worker',
  /** The service worker and this extension's own pages. */
  ExtensionPages = 'extension-pages',
}

export enum ExtensionSessionSenderAdmission {
  Admitted = 'admitted',
  Forbidden = 'forbidden',
}

type ExtensionSessionAudiences = Readonly<
  Record<ExtensionSessionMessageType, ExtensionSessionRequestAudience>
>

/**
 * The offscreen session's sender gate. Content scripts carry a tab and the
 * page's URL and never reach the session directly. Extension pages (the
 * Nook tab, the side panel, the login picker) send only the page requests;
 * every request that reveals, lists or writes vault content, seals identity
 * material or stages credentials is the service worker's alone.
 */
export class ExtensionSessionSenderPolicy {
  private static readonly audiences: ExtensionSessionAudiences = {
    [ExtensionSessionMessageType.ClassifyGrantAuthority]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.Reset]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.MigrateAuthProviders]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.Status]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.BeginPasskeySetup]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.FinishPasskeySetup]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.RecoverPasskey]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.UnlockOptions]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.UnlockPasskey]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.CreatePin]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.UnlockPin]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.ImportVault]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.JoinIdentity]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.ConnectIdentityVault]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.RefreshIdentityVaults]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.BeginIdentityConnection]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.CancelIdentityConnection]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.ActivateIdentity]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.UpdateVault]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.ExportVaultEventLog]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.VaultSummary]:
      ExtensionSessionRequestAudience.ExtensionPages,
    [ExtensionSessionMessageType.ListPasskeys]:
      ExtensionSessionRequestAudience.ServiceWorker,
    // The extension smoke e2e still lists logins from the Nook tab.
    [ExtensionSessionMessageType.ListLogins]:
      ExtensionSessionRequestAudience.ExtensionPages,
    // Lists authenticators and passkeys too, so only the service worker may ask.
    [ExtensionSessionMessageType.ListSiteSecrets]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.RevealLogin]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.RevealFocusedLogin]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.ListPersonalRecords]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.RevealPersonalFill]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.ListAuthenticators]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AuthenticatorCode]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AuthenticatorEnrollPreview]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AuthenticatorEnrollCode]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AuthenticatorEnrollConfirm]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AuthenticatorBackupAttach]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.PlanLoginSave]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.PendingLoginSave]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.CommitLoginSave]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.DismissLoginSave]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.CancelPasskey]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.RegisterPasskey]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.AssertPasskey]:
      ExtensionSessionRequestAudience.ServiceWorker,
    [ExtensionSessionMessageType.Lock]:
      ExtensionSessionRequestAudience.ExtensionPages,
  }

  constructor(private readonly sender: chrome.runtime.MessageSender) {}

  kind(): ExtensionSessionSenderKind {
    const runtime = chrome.runtime
    const url = this.sender.url
    switch (true) {
      case !this.sender.tab &&
        (!url || url === runtime.getURL('background/service-worker.js')):
        return ExtensionSessionSenderKind.ServiceWorker
      case typeof url === 'string' && url.startsWith(runtime.getURL('')):
        return ExtensionSessionSenderKind.ExtensionPage
      case true:
      default:
        return ExtensionSessionSenderKind.Other
    }
  }

  admission(
    type: ExtensionSessionMessageType,
  ): ExtensionSessionSenderAdmission {
    switch (this.kind()) {
      case ExtensionSessionSenderKind.ServiceWorker:
        return ExtensionSessionSenderAdmission.Admitted
      case ExtensionSessionSenderKind.Other:
        return ExtensionSessionSenderAdmission.Forbidden
      case ExtensionSessionSenderKind.ExtensionPage:
        break
    }
    switch (ExtensionSessionSenderPolicy.audiences[type]) {
      case ExtensionSessionRequestAudience.ExtensionPages:
        return ExtensionSessionSenderAdmission.Admitted
      case ExtensionSessionRequestAudience.ServiceWorker:
        return ExtensionSessionSenderAdmission.Forbidden
    }
  }
}
