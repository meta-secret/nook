import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import {
  ExtensionConnectFailureReason,
  ExtensionConnectStepKind,
  type ExtensionConnectStep,
} from '../../../nook-web-shared/src/extension/extension-connect-progress'
import {
  DeviceProtectionStatus,
  type NookIdentityConnectionStart,
} from '../lib/nook-wasm'
import {
  SidePanelConnectEventKind,
  type SidePanelConnectEvent,
} from './side-panel-connect-port'
import { SidePanelVaultsKind } from './side-panel-state'

/**
 * Connecting an identity from the panel: one action opens (or reuses) the
 * Nook tab on the connect route, and the panel follows the steps the page
 * reports until the identity is approved or the tab goes away. Creating,
 * joining and choosing the identity all happen on the page.
 */
export enum SidePanelConnectKind {
  Idle = 'idle',
  /** Rust is choosing the connecting key, or the Nook tab is opening. */
  Starting = 'starting',
  /** The next identity waits for its own passkey or PIN, set up in place. */
  IdentityKey = 'identity-key',
  /** The Nook tab shows the connect route; the panel follows it. */
  InTab = 'in-tab',
  Failed = 'failed',
}

/** Why a connect stopped before the page approved it. */
export enum SidePanelConnectFailure {
  /** The Nook tab could not be opened. */
  Start = 'start',
  /** The page sent a message the panel does not understand. */
  Protocol = 'protocol',
  /** The panel could not check where the page's port came from. */
  SenderCheck = 'sender-check',
}

export enum SidePanelTabFollowKind {
  /** The page has not reported a step yet. */
  Waiting = 'waiting',
  Following = 'following',
}

export type SidePanelTabFollow =
  | { readonly kind: SidePanelTabFollowKind.Waiting }
  | {
      readonly kind: SidePanelTabFollowKind.Following
      readonly step: ExtensionConnectStep
    }

/** Whether the Nook tab is the tab its window shows. Show Nook tab is
 * offered only while another tab covers it. */
export enum SidePanelTabPlace {
  /** The service worker activates the tab it opens or reuses. */
  Front = 'front',
  /** Another tab of the panel's window became active. */
  Behind = 'behind',
}

export enum SidePanelTabActivationKind {
  /** No tab became active while the Nook tab was opening. */
  None = 'none',
  Seen = 'seen',
}

/** The last tab that became active in the panel's window while the Nook
 * tab was opening, before its id was known. */
export type SidePanelTabActivation =
  | { readonly kind: SidePanelTabActivationKind.None }
  | { readonly kind: SidePanelTabActivationKind.Seen; readonly tabId: number }

export type SidePanelConnect =
  | { readonly kind: SidePanelConnectKind.Idle }
  | { readonly kind: SidePanelConnectKind.Starting }
  | {
      readonly kind: SidePanelConnectKind.IdentityKey
      /** Passkey setup, or PIN setup when passkeys cannot work here. */
      readonly status: DeviceProtectionStatus
    }
  | {
      readonly kind: SidePanelConnectKind.InTab
      /** The Nook tab the service worker opened or reused. */
      readonly tabId: number
      readonly follow: SidePanelTabFollow
      readonly place: SidePanelTabPlace
    }
  | {
      readonly kind: SidePanelConnectKind.Failed
      readonly failure: SidePanelConnectFailure
    }

/** Whether the connect card leads the panel or opened under This site. */
export enum SidePanelConnectCardPlacement {
  /** No identity is connected: the card cannot be closed.
   * @public Used from Svelte templates; Knip cannot trace enum members there. */
  First = 'first',
  /** Connect another identity opened it; its close button closes it.
   * @public Used from Svelte templates; Knip cannot trace enum members there. */
  Another = 'another',
}

/** What the panel does once Rust chose the connecting key. */
export enum SidePanelConnectStep {
  /** The unlocked key joins the identity: open the Nook tab now. */
  Pair = 'pair',
  /** A new identity was staged: its key is set up first. */
  SetUpKey = 'set-up-key',
}

/** Whether Connect may start a connect now. */
export enum SidePanelConnectActivity {
  Ready = 'ready',
  Busy = 'busy',
}

/** What a page event asks of the panel besides its new connect state. */
export enum SidePanelConnectFollowUp {
  None = 'none',
  /** The identity was approved: read the paired vaults again. */
  ReadVaults = 'read-vaults',
}

export type SidePanelConnectAdvance = {
  readonly connect: SidePanelConnect
  readonly followUp: SidePanelConnectFollowUp
}

type SidePanelConnectEventRequest = {
  readonly connect: SidePanelConnect
  readonly event: SidePanelConnectEvent
}

type SidePanelCardRequest = {
  readonly vaults: SidePanelVaultsKind
  readonly connect: SidePanelConnect
}

export class SidePanelConnects {
  private constructor() {}

  static step(start: NookIdentityConnectionStart): SidePanelConnectStep {
    switch (start) {
      case 'current-key':
        return SidePanelConnectStep.Pair
      case 'new-key-staged':
        return SidePanelConnectStep.SetUpKey
    }
  }

  /** The new identity's key starts as a passkey, as the Nook tab's does. */
  static identityKey(): SidePanelConnect {
    return {
      kind: SidePanelConnectKind.IdentityKey,
      status: DeviceProtectionStatus.Missing,
    }
  }

  /** The Nook tab shows the connect route; no step arrived yet. It is in
   * front unless another tab became active while it was opening. */
  static inTab(
    tabId: number,
    activation: SidePanelTabActivation,
  ): SidePanelConnect {
    const opened: SidePanelConnect = {
      kind: SidePanelConnectKind.InTab,
      tabId,
      follow: { kind: SidePanelTabFollowKind.Waiting },
      place: SidePanelTabPlace.Front,
    }
    switch (activation.kind) {
      case SidePanelTabActivationKind.None:
        return opened
      case SidePanelTabActivationKind.Seen:
        return SidePanelConnects.tabActivated(opened, activation.tabId)
    }
  }

  /** A tab became active in the panel's window: the Nook tab is in front
   * only when it is that tab. */
  static tabActivated(
    connect: SidePanelConnect,
    activeTabId: number,
  ): SidePanelConnect {
    switch (connect.kind) {
      case SidePanelConnectKind.InTab:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Failed:
        return connect
    }
    switch (connect.tabId === activeTabId) {
      case true:
        return { ...connect, place: SidePanelTabPlace.Front }
      case false:
        return { ...connect, place: SidePanelTabPlace.Behind }
    }
  }

  /** The panel's connect after an event from the Nook tab. */
  static advance(
    request: SidePanelConnectEventRequest,
  ): SidePanelConnectAdvance {
    const { connect, event } = request
    switch (connect.kind) {
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Starting:
        break
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.Failed:
        return { connect, followUp: SidePanelConnectFollowUp.None }
    }
    switch (event.kind) {
      case SidePanelConnectEventKind.Closed:
        // The tab closed, reloaded or navigated away: the card returns.
        return {
          connect: { kind: SidePanelConnectKind.Idle },
          followUp: SidePanelConnectFollowUp.None,
        }
      case SidePanelConnectEventKind.ProtocolFailure:
        return {
          connect: {
            kind: SidePanelConnectKind.Failed,
            failure: SidePanelConnectFailure.Protocol,
          },
          followUp: SidePanelConnectFollowUp.None,
        }
      case SidePanelConnectEventKind.SenderCheckFailure:
        return {
          connect: {
            kind: SidePanelConnectKind.Failed,
            failure: SidePanelConnectFailure.SenderCheck,
          },
          followUp: SidePanelConnectFollowUp.None,
        }
      case SidePanelConnectEventKind.Step:
        break
    }
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
        // The tab id arrives next; the session reports the step again then.
        return { connect, followUp: SidePanelConnectFollowUp.None }
      case SidePanelConnectKind.InTab:
        break
    }
    switch (event.step.kind) {
      case ExtensionConnectStepKind.Approved:
        return {
          connect: { kind: SidePanelConnectKind.Idle },
          followUp: SidePanelConnectFollowUp.ReadVaults,
        }
      case ExtensionConnectStepKind.Opened:
      case ExtensionConnectStepKind.Unlock:
      case ExtensionConnectStepKind.Choosing:
      case ExtensionConnectStepKind.Creating:
      case ExtensionConnectStepKind.Consent:
      case ExtensionConnectStepKind.Failed:
        return {
          connect: {
            ...connect,
            follow: {
              kind: SidePanelTabFollowKind.Following,
              step: event.step,
            },
          },
          followUp: SidePanelConnectFollowUp.None,
        }
    }
  }

  /** The line under the card while the Nook tab is open. */
  static followLine(follow: SidePanelTabFollow): I18nKey {
    switch (follow.kind) {
      case SidePanelTabFollowKind.Waiting:
        return I18N_KEYS.ExtensionActionContinueInTab
      case SidePanelTabFollowKind.Following:
        return SidePanelConnects.stepLine(follow.step)
    }
  }

  private static stepLine(step: ExtensionConnectStep): I18nKey {
    switch (step.kind) {
      case ExtensionConnectStepKind.Opened:
        return I18N_KEYS.ExtensionConnectTabOpened
      case ExtensionConnectStepKind.Unlock:
        return I18N_KEYS.ExtensionConnectTabUnlock
      case ExtensionConnectStepKind.Choosing:
        return I18N_KEYS.ExtensionConnectTabChoosing
      case ExtensionConnectStepKind.Creating:
        return I18N_KEYS.ExtensionConnectTabCreating
      case ExtensionConnectStepKind.Consent:
        return I18N_KEYS.ExtensionConnectTabConsent
      case ExtensionConnectStepKind.Approved:
        return I18N_KEYS.ExtensionConnectTabApproved
      case ExtensionConnectStepKind.Failed:
        return SidePanelConnects.failureLine(step.reason)
    }
  }

  private static failureLine(reason: ExtensionConnectFailureReason): I18nKey {
    switch (reason) {
      case ExtensionConnectFailureReason.Authorization:
        return I18N_KEYS.ExtensionConnectTabFailedAuthorization
      case ExtensionConnectFailureReason.Grant:
        return I18N_KEYS.ExtensionConnectTabFailedGrant
      case ExtensionConnectFailureReason.Delivery:
        return I18N_KEYS.ExtensionConnectTabFailedDelivery
    }
  }

  /** The alert of a connect that stopped. */
  static failureAlert(failure: SidePanelConnectFailure): I18nKey {
    switch (failure) {
      case SidePanelConnectFailure.Start:
        return I18N_KEYS.ExtensionActionOpenFailed
      case SidePanelConnectFailure.Protocol:
        return I18N_KEYS.ExtensionConnectTabInterrupted
      case SidePanelConnectFailure.SenderCheck:
        return I18N_KEYS.ExtensionConnectTabSenderCheckFailed
    }
  }

  /** Whether the card shows: always while no identity is connected,
   * otherwise while a connect runs or just failed. */
  static cardShown(request: SidePanelCardRequest): boolean {
    switch (request.vaults) {
      case SidePanelVaultsKind.NoVault:
        return true
      case SidePanelVaultsKind.Loading:
      case SidePanelVaultsKind.Paired:
      case SidePanelVaultsKind.Failed:
        break
    }
    switch (request.connect.kind) {
      case SidePanelConnectKind.Idle:
        return false
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.InTab:
      case SidePanelConnectKind.Failed:
        return true
    }
  }

  /** The key ceremony owns the panel until it finishes or is cancelled:
   * a status read meanwhile must not replace it. */
  static holdsPanel(connect: SidePanelConnect): boolean {
    return connect.kind === SidePanelConnectKind.IdentityKey
  }

  /** A connect already under way ignores another Connect. */
  static activity(connect: SidePanelConnect): SidePanelConnectActivity {
    switch (connect.kind) {
      case SidePanelConnectKind.Starting:
      case SidePanelConnectKind.IdentityKey:
      case SidePanelConnectKind.InTab:
        return SidePanelConnectActivity.Busy
      case SidePanelConnectKind.Idle:
      case SidePanelConnectKind.Failed:
        return SidePanelConnectActivity.Ready
    }
  }
}
