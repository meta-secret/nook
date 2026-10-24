import { Effect } from 'effect'
import { AuthenticationGesture } from '../../lib/auth-widget-policy'
import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../../lib/browser-message-keys'
import {
  SiteVaultConnectMessageType,
  SiteVaultConnectMessages,
  SiteVaultConnectResponseKind,
  type SiteVaultConnectMessage,
  type SiteVaultConnectResponse,
} from '../../lib/site-vault-connect-messages'
import type { FocusedCredentialTargetSensor } from './focused-credential-target'
import {
  authenticationRuntimeTransport,
  RuntimeMessageDeliveryKind,
} from './runtime-message-adapter'
import { SiteSidePanel } from './site-side-panel'
import { widgetState } from './state'
import { WidgetVaultGateKind } from './widget-presentation-state'
import { workflowUi } from './workflow-ui'

/** What the widget offers again once the vault connection changes. */
export enum VaultConnectResumeKind {
  /** The page's own scan finds the form again. */
  Page = 'page',
  /** The focused field the widget was offered for. */
  Field = 'field',
}

export type VaultConnectResumeTarget =
  | { readonly kind: VaultConnectResumeKind.Page }
  | {
      readonly kind: VaultConnectResumeKind.Field
      readonly input: HTMLInputElement
    }

enum VaultConnectResumeStateKind {
  Empty = 'empty',
  Waiting = 'waiting',
}

type VaultConnectResumeState =
  | { readonly kind: VaultConnectResumeStateKind.Empty }
  | {
      readonly kind: VaultConnectResumeStateKind.Waiting
      readonly target: VaultConnectResumeTarget
      readonly expiresAt: number
    }

export type VaultConnectResumeSensors = readonly FocusedCredentialTargetSensor[]

/**
 * Remembers, for this document only, the field a connect started from, so
 * the widgets that the approval rebuilds offer that field's action again
 * without another focus. Nothing about the vault is kept.
 */
export class VaultConnectResume {
  static readonly TTL_MS = 15 * 60 * 1000

  private state: VaultConnectResumeState = {
    kind: VaultConnectResumeStateKind.Empty,
  }

  remember(target: VaultConnectResumeTarget): void {
    this.state = {
      kind: VaultConnectResumeStateKind.Waiting,
      target,
      expiresAt: Date.now() + VaultConnectResume.TTL_MS,
    }
  }

  /** Retains the remembered field in every focus sensor, once. */
  resume(sensors: VaultConnectResumeSensors): void {
    const state = this.state
    this.state = { kind: VaultConnectResumeStateKind.Empty }
    switch (state.kind) {
      case VaultConnectResumeStateKind.Empty:
        return
      case VaultConnectResumeStateKind.Waiting:
        break
    }
    switch (state.target.kind) {
      case VaultConnectResumeKind.Page:
        return
      case VaultConnectResumeKind.Field:
        break
    }
    const input = state.target.input
    switch (state.expiresAt > Date.now() && input.isConnected) {
      case false:
        return
      case true:
        for (const sensor of sensors) sensor.retain(input)
    }
  }
}

export const vaultConnectResume = new VaultConnectResume()

type VaultGateShell = {
  readonly step: HTMLParagraphElement
  readonly title: HTMLHeadingElement
  readonly description: HTMLParagraphElement
  readonly continueButton: HTMLButtonElement
  readonly body: HTMLDivElement
  readonly collapsedLaunch: HTMLButtonElement
}

export type WidgetVaultGateMount = {
  readonly shell: VaultGateShell
  readonly gate: WidgetVaultGateKind.Connect | WidgetVaultGateKind.Unlock
  readonly resume: VaultConnectResumeTarget
}

type VaultGateCopy = {
  readonly title: BrowserMessageKey
  readonly description: BrowserMessageKey
  readonly action: BrowserMessageKey
}

/**
 * Renders the connect-first or unlock-first state in place of a widget's
 * vault action. The person can connect or unlock, or leave the page alone.
 */
export class WidgetVaultGateSurface {
  private constructor(private readonly mount: WidgetVaultGateMount) {}

  static render(mount: WidgetVaultGateMount): WidgetVaultGateSurface {
    const surface = new WidgetVaultGateSurface(mount)
    surface.renderCopy()
    surface.renderActions()
    return surface
  }

  private copy(): VaultGateCopy {
    switch (this.mount.gate) {
      case WidgetVaultGateKind.Connect:
        return {
          title: BROWSER_MESSAGE_KEYS.WidgetConnectFirstTitle,
          description: BROWSER_MESSAGE_KEYS.WidgetConnectFirstDescription,
          action: BROWSER_MESSAGE_KEYS.WidgetConnectFirstAction,
        }
      case WidgetVaultGateKind.Unlock:
        return {
          title: BROWSER_MESSAGE_KEYS.WidgetUnlockFirstTitle,
          description: BROWSER_MESSAGE_KEYS.WidgetUnlockThenContinue,
          action: BROWSER_MESSAGE_KEYS.WidgetUnlock,
        }
    }
  }

  private renderCopy(): void {
    const { step, title, description, continueButton, collapsedLaunch } =
      this.mount.shell
    const copy = this.copy()
    // No workflow runs before the vault is ready, so no progress is shown.
    const pilotLabel = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetPilotLabel,
    )
    step.textContent = pilotLabel
    for (const progress of collapsedLaunch.querySelectorAll(
      '.collapsed-progress',
    )) {
      progress.textContent = pilotLabel
    }
    collapsedLaunch.setAttribute(
      'aria-label',
      `${workflowUi.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetExpand)}: ${pilotLabel}`,
    )
    title.textContent = workflowUi.translatedMessage(copy.title)
    description.textContent = workflowUi.translatedMessage(copy.description)
    const action = workflowUi.translatedMessage(copy.action)
    continueButton.textContent = action
    continueButton.setAttribute('aria-label', action)
    continueButton.hidden = false
    continueButton.disabled = false
    continueButton.setAttribute('data-nook-vault-gate', this.mount.gate)
  }

  private renderActions(): void {
    const { continueButton, body } = this.mount.shell
    continueButton.addEventListener('click', (event) => {
      switch (new AuthenticationGesture(event).trusted) {
        case false:
          return
        case true:
          this.activate()
      }
    })
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'text-button'
    dismiss.setAttribute('data-testid', 'nook-vault-gate-dismiss')
    dismiss.textContent = workflowUi.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetGateDismiss,
    )
    dismiss.addEventListener('click', () => {
      widgetState.dismissed = true
      workflowUi.removeWidget()
    })
    body.append(dismiss)
  }

  private activate(): void {
    switch (this.mount.gate) {
      case WidgetVaultGateKind.Unlock:
        SiteSidePanel.open()
        return
      case WidgetVaultGateKind.Connect:
        vaultConnectResume.remember(this.mount.resume)
        void this.connect()
    }
  }

  private connect(): Promise<void> {
    const message: SiteVaultConnectMessage = {
      type: SiteVaultConnectMessageType.Connect,
    }
    const request: Parameters<
      typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<SiteVaultConnectResponse>
    >[0] = {
      message,
      decode: (response) =>
        Effect.runSync(SiteVaultConnectMessages.decodeResponse(response)),
    }
    const failed: SiteVaultConnectResponse = {
      kind: SiteVaultConnectResponseKind.Failed,
    }
    return Effect.runPromise(
      Effect.tryPromise(() =>
        authenticationRuntimeTransport.sendDecodedRuntimeMessage(request),
      ).pipe(
        Effect.map((delivery) => this.response(delivery)),
        Effect.catch(() => Effect.succeed(failed)),
        Effect.map((response) => this.show(response)),
      ),
    )
  }

  private response(
    delivery: Awaited<
      ReturnType<
        typeof authenticationRuntimeTransport.sendDecodedRuntimeMessage<SiteVaultConnectResponse>
      >
    >,
  ): SiteVaultConnectResponse {
    switch (delivery.kind) {
      case RuntimeMessageDeliveryKind.Delivered:
        return delivery.response
      case RuntimeMessageDeliveryKind.Unavailable:
        return { kind: SiteVaultConnectResponseKind.Failed }
    }
  }

  private show(response: SiteVaultConnectResponse): void {
    const { description } = this.mount.shell
    switch (response.kind) {
      case SiteVaultConnectResponseKind.Opened:
        description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetConnectFirstOpened,
        )
        return
      case SiteVaultConnectResponseKind.Failed:
        description.textContent = workflowUi.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetConnectFirstFailed,
        )
        description.setAttribute('role', 'alert')
    }
  }
}
