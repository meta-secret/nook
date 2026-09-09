import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
import { recoveryCopyObservation } from '../lib/backup-code-candidates'
import {
  AuthenticationWorkflowAction,
  AuthenticatorEnrollmentConfirmResponseKind,
  AuthenticatorEnrollmentStageResponseKind,
  AuthenticatorPreviewResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  type DecodedOtpauthCandidate,
  pageQrCapture,
} from '../lib/page-qr-capture'
import { AuthenticationGesture } from '../lib/auth-widget-policy'
import {
  WebsiteAuthenticatorEnrollConfirmMessageType,
  WebsiteAuthenticatorEnrollPreviewMessageType,
  WebsiteAuthenticatorEnrollStageMessageType,
} from '../lib/enrollment-messages'
import {
  RuntimeMessageDeliveryKind,
  type AuthenticatorBackupAttachResponse,
  type AuthenticatorEnrollmentConfirmResponse,
  type AuthenticatorEnrollmentStageResponse,
  type AuthenticatorOptionsResponse,
  type AuthenticatorPreviewResponse,
  type DecodedRuntimeMessageArgs,
  type RuntimeMessageDelivery,
} from './autofill/login-passkey-actions'
import {
  type EnrollmentFlowViewHost,
  type EnrollmentPageHints,
  enrollmentFlowRenderer,
} from './enrollment-flow-view'
import {
  type BackupEnrollmentHost,
  enrollmentBackupInteraction,
} from './enrollment-backup-flow'
import { RevalidatedEnrollmentAction } from './autofill/backup-code-workflow-action'

export type { EnrollmentPageHints } from './enrollment-flow-view'

type TranslatedMessageWithSubstitutionArgs = {
  key: BrowserMessageKey
  substitution: string
}

export type EnrollmentFlowHost = EnrollmentFlowViewHost & {
  step: HTMLParagraphElement
  continueButton: HTMLButtonElement
  openVaultButton: HTMLButtonElement
  setBusy: (busy: boolean) => void
  isBusy: () => boolean
  sendDecodedRuntimeMessage: <Response>(
    args: DecodedRuntimeMessageArgs<Response>,
  ) => Promise<RuntimeMessageDelivery<Response>>
  sendAuthenticationOutcomeRuntimeMessage: typeof import('./autofill/login-passkey-actions').sendAuthenticationOutcomeRuntimeMessage
  sendAuthenticatorBackupAttachRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorBackupAttachRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorBackupAttachResponse>>
  sendAuthenticatorEnrollmentConfirmRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorEnrollmentConfirmRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentConfirmResponse>>
  sendAuthenticatorEnrollmentStageRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorEnrollmentStageRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentStageResponse>>
  sendAuthenticatorCodeRuntimeMessage: typeof import('./autofill/login-passkey-actions').sendAuthenticatorCodeRuntimeMessage
  sendAuthenticatorOptionsRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorOptionsRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorOptionsResponse>>
  sendAuthenticatorPreviewRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorPreviewRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorPreviewResponse>>
  sendRuntimeMessageWithoutResponse: typeof import('./autofill/login-passkey-actions').sendRuntimeMessageWithoutResponse
  translatedMessage: (key: BrowserMessageKey) => string
  translatedMessageWithSubstitution: (
    args: TranslatedMessageWithSubstitutionArgs,
  ) => string
}

type CommitStagedEnrollmentArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  stageId: string
  vaultStoreId: string
}

type BeginEnrollmentCeremonyArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  vaultStoreId: string
  otpauthUri: { value: string }
  candidate: DecodedOtpauthCandidate
}

type ClearOtpauthUriArgs = { value: string }

type ShowQrPreviewArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  otpauthUri: { value: string }
  candidate: DecodedOtpauthCandidate
}

type ShowQrCandidatePickerArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  candidates: DecodedOtpauthCandidate[]
}

type StartQrEnrollmentArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
}

type RenderEnrollmentActionsArgs = {
  host: EnrollmentFlowHost
  hints: EnrollmentPageHints
}

type StartBackupCodeEnrollmentArgs = {
  host: EnrollmentFlowHost
  section?: HTMLElement
}

/** Owns the browser runtime resources shared by these interactions. */
class AuthenticatorEnrollmentInteraction {
  private holdEnrollmentWidgetAfterSave = false
  private enrollmentSavePending = false
  detectEnrollmentHints(): EnrollmentPageHints {
    const [copy, backupCodes] =
      recoveryCopyObservation.authenticationRecoveryEvidence()
    const hints = this.detectEnrollmentHintsFromRecoveryCopy(copy)
    hints.backupCodes = backupCodes
    return hints
  }

  detectEnrollmentHintsFromRecoveryCopy(
    recoveryCopy: string,
  ): EnrollmentPageHints {
    return {
      qr: pageQrCapture.pageHasQrEnrollmentHint(),
      backupCodes:
        recoveryCopyObservation.recoveryCopyHasBackupCodeHint(recoveryCopy),
    }
  }

  private async commitStagedEnrollment({
    host,
    section,
    stageId,
    vaultStoreId,
  }: CommitStagedEnrollmentArgs): Promise<void> {
    const nookTypedArgs0_0: Parameters<
      typeof enrollmentFlowRenderer.setHostDescription
    >[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
    }
    enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_0)
    const confirmMessage: Parameters<
      typeof host.sendAuthenticatorEnrollmentConfirmRuntimeMessage
    >[0] = {
      type: WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm,
      payload: {
        origin: location.origin,
        vaultStoreId,
        stageId,
      },
    }
    const confirmDelivery = await host
      .sendAuthenticatorEnrollmentConfirmRuntimeMessage(confirmMessage)
      .finally(() => {
        this.enrollmentSavePending = false
      })
    if (
      confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
      confirmDelivery.response.kind ===
        AuthenticatorEnrollmentConfirmResponseKind.Completed
    ) {
      const nookTypedArgs0_1: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollSaved),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_1)
      if (this.detectEnrollmentHints().backupCodes) {
        const nookTypedArgs0_2: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_2)
      }
      // Success pages often mention backup codes; without this hold, the next
      // MutationObserver scan rebuilds the enrollment CTA and wipes the saved
      // confirmation before the user (or e2e) can observe it.
      this.holdEnrollmentWidgetAfterSave = true
    } else if (
      confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
      confirmDelivery.response.kind ===
        AuthenticatorEnrollmentConfirmResponseKind.Rejected &&
      'reason' in confirmDelivery.response &&
      confirmDelivery.response.reason === 'authenticator-locked'
    ) {
      const nookTypedArgs0_3: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: this.lockedEnrollMessage(host),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_3)
    } else {
      const nookTypedArgs0_4: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_4)
    }
    host.setBusy(false)
    section.replaceChildren()
  }

  async beginEnrollmentCeremony({
    host,
    section,
    vaultStoreId,
    otpauthUri,
    candidate,
  }: BeginEnrollmentCeremonyArgs): Promise<void> {
    this.holdEnrollmentWidgetAfterSave = false
    this.enrollmentSavePending = true
    const nookTypedArgs0_8: Parameters<
      typeof enrollmentFlowRenderer.setHostDescription
    >[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollStaging),
    }
    enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_8)
    const message: Parameters<
      typeof host.sendAuthenticatorEnrollmentStageRuntimeMessage
    >[0] = {
      type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage,
      payload: {
        origin: location.origin,
        vaultStoreId,
        otpauthUri: otpauthUri.value,
      },
    }
    const stageDelivery = await host
      .sendAuthenticatorEnrollmentStageRuntimeMessage(message)
      .finally(() => {
        this.clearOtpauthUri(otpauthUri)
        this.clearCandidate(candidate)
      })
    if (stageDelivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      const nookTypedArgs0_10: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_10)
      host.setBusy(false)
      const nookTypedArgs0_11: Parameters<
        typeof this.renderEnrollmentActions
      >[0] = {
        host,
        hints: this.detectEnrollmentHints(),
      }
      this.enrollmentSavePending = false
      this.renderEnrollmentActions(nookTypedArgs0_11)
      return
    }
    const { response: stageResponse } = stageDelivery
    if (
      stageResponse.kind !== AuthenticatorEnrollmentStageResponseKind.Staged ||
      !('stageId' in stageResponse)
    ) {
      const nookTypedArgs0_12: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_12)
      host.setBusy(false)
      const nookTypedArgs0_13: Parameters<
        typeof this.renderEnrollmentActions
      >[0] = {
        host,
        hints: this.detectEnrollmentHints(),
      }
      this.enrollmentSavePending = false
      this.renderEnrollmentActions(nookTypedArgs0_13)
      return
    }
    const nookTypedArgs0_14: Parameters<typeof this.commitStagedEnrollment>[0] =
      {
        host,
        section,
        stageId: stageResponse.stageId,
        vaultStoreId,
      }
    await this.commitStagedEnrollment(nookTypedArgs0_14)
  }

  private clearOtpauthUri(uri: ClearOtpauthUriArgs): void {
    uri.value = ''
  }

  private clearCandidate(candidate: DecodedOtpauthCandidate): void {
    pageQrCapture.clearOtpauthCandidate(candidate)
  }

  private unavailableMessage(host: EnrollmentFlowHost): string {
    return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
  }

  private lockedEnrollMessage(host: EnrollmentFlowHost): string {
    return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock)
  }

  private async showQrPreview({
    host,
    section,
    otpauthUri,
    candidate,
  }: ShowQrPreviewArgs): Promise<void> {
    section.replaceChildren()
    host.title.textContent = host.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetEnrollPreview,
    )
    const nookTypedArgs0_19: Parameters<
      typeof enrollmentFlowRenderer.setHostDescription
    >[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
    }
    enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_19)
    host.setBusy(true)

    try {
      const message: Parameters<
        typeof host.sendAuthenticatorPreviewRuntimeMessage
      >[0] = {
        type: WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview,
        payload: {
          origin: location.origin,
          otpauthUri: otpauthUri.value,
        },
      }
      const delivery =
        await host.sendAuthenticatorPreviewRuntimeMessage(message)

      if (
        delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
        delivery.response.kind === AuthenticatorPreviewResponseKind.Rejected
      ) {
        const nookTypedArgs0_20: Parameters<
          typeof enrollmentFlowRenderer.setHostDescription
        >[0] = {
          host,
          text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
        }
        enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_20)
        const nookTypedArgs0_21: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_21)
        this.clearOtpauthUri(otpauthUri)
        this.clearCandidate(candidate)
        return
      }
      const { response } = delivery

      if (response.kind === AuthenticatorPreviewResponseKind.Unavailable) {
        const nookTypedArgs0_22: Parameters<
          typeof enrollmentFlowRenderer.setHostDescription
        >[0] = {
          host,
          text: this.unavailableMessage(host),
        }
        enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_22)
        const nookTypedArgs0_23: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_23)
        this.clearOtpauthUri(otpauthUri)
        this.clearCandidate(candidate)
        return
      }

      if (
        response.kind !== AuthenticatorPreviewResponseKind.Ready ||
        !('preview' in response) ||
        !('vaultStoreId' in response)
      ) {
        throw new Error('Rust returned an unexpected authenticator preview.')
      }

      const { preview, vaultStoreId } = response

      const nookTypedArgs0_26: Parameters<
        typeof enrollmentFlowRenderer.setHostDescription
      >[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollPreview),
      }
      enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_26)
      const nookTypedArgs0_27: Parameters<
        typeof enrollmentFlowRenderer.renderPreviewDetails
      >[0] = {
        container: section,
        host,
        preview,
      }
      enrollmentFlowRenderer.renderPreviewDetails(nookTypedArgs0_27)

      const nookTypedArgs1_3: Parameters<
        typeof enrollmentFlowRenderer.createPrimaryButton
      >[0] = {
        host,
        labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollConfirm,
        onClick: (event) => {
          if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
          host.setBusy(true)
          confirmButton.disabled = true
          cancelButton.disabled = true
          const nookTypedArgs0_28: Parameters<
            typeof this.beginEnrollmentCeremony
          >[0] = {
            host,
            section,
            vaultStoreId,
            otpauthUri,
            candidate,
          }
          void this.beginEnrollmentCeremony(nookTypedArgs0_28)
        },
      }
      const confirmButton =
        enrollmentFlowRenderer.createPrimaryButton(nookTypedArgs1_3)

      const nookTypedArgs1_4: Parameters<
        typeof enrollmentFlowRenderer.createTextButton
      >[0] = {
        host,
        labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
        onClick: (event) => {
          if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
          this.clearOtpauthUri(otpauthUri)
          this.clearCandidate(candidate)
          const nookTypedArgs0_29: Parameters<
            typeof enrollmentFlowRenderer.resetEnrollmentHeadline
          >[0] = { host, hints: this.detectEnrollmentHints() }
          enrollmentFlowRenderer.resetEnrollmentHeadline(nookTypedArgs0_29)
          const nookTypedArgs0_30: Parameters<
            typeof this.renderEnrollmentActions
          >[0] = { host, hints: this.detectEnrollmentHints() }
          this.renderEnrollmentActions(nookTypedArgs0_30)
        },
      }
      const cancelButton =
        enrollmentFlowRenderer.createTextButton(nookTypedArgs1_4)

      const nookTypedArgs0_31: Parameters<
        typeof enrollmentFlowRenderer.appendButtonRow
      >[0] = {
        container: section,
        buttons: [confirmButton, cancelButton],
      }
      enrollmentFlowRenderer.appendButtonRow(nookTypedArgs0_31)
    } finally {
      host.setBusy(false)
    }
  }

  private showQrCandidatePicker({
    host,
    section,
    candidates,
  }: ShowQrCandidatePickerArgs): void {
    section.replaceChildren()
    const nookTypedArgs0_32: Parameters<
      typeof enrollmentFlowRenderer.setHostDescription
    >[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollAmbiguous),
    }
    enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_32)
    const list = document.createElement('div')
    list.className = 'account-list'
    candidates.forEach((candidate) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'secondary-button account-button'
      button.textContent = candidate.sourceLabel
      button.setAttribute('aria-label', candidate.sourceLabel)
      button.addEventListener('click', (event) => {
        if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
        const uri = { value: candidate.otpauthUri }
        const nookTypedArgs0_33: Parameters<typeof this.showQrPreview>[0] = {
          host,
          section,
          otpauthUri: uri,
          candidate,
        }
        void this.showQrPreview(nookTypedArgs0_33)
      })
      list.append(button)
    })
    section.append(list)
    const nookTypedArgs1_5: Parameters<
      typeof enrollmentFlowRenderer.createTextButton
    >[0] = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
      onClick: (event) => {
        if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
        candidates.forEach((candidate) => this.clearCandidate(candidate))
        const nookTypedArgs0_34: Parameters<
          typeof enrollmentFlowRenderer.resetEnrollmentHeadline
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        enrollmentFlowRenderer.resetEnrollmentHeadline(nookTypedArgs0_34)
        const nookTypedArgs0_35: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_35)
      },
    }
    const cancelButton =
      enrollmentFlowRenderer.createTextButton(nookTypedArgs1_5)
    section.append(cancelButton)
  }

  async startQrEnrollment({
    host,
    section,
  }: StartQrEnrollmentArgs): Promise<void> {
    this.releaseEnrollmentWidgetHold()
    host.title.textContent = host.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
    )
    const nookTypedArgs0_36: Parameters<
      typeof enrollmentFlowRenderer.setHostDescription
    >[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
    }
    enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_36)
    host.setBusy(true)
    section.replaceChildren()

    try {
      const result = await pageQrCapture.decodeVisibleOtpauthCandidates()
      if (result.status === 'unsupported') {
        const nookTypedArgs0_37: Parameters<
          typeof enrollmentFlowRenderer.setHostDescription
        >[0] = {
          host,
          text: host.translatedMessage(
            BROWSER_MESSAGE_KEYS.WidgetEnrollUnsupported,
          ),
        }
        enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_37)
        const nookTypedArgs0_38: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_38)
        return
      }
      if (result.status === 'empty') {
        const nookTypedArgs0_39: Parameters<
          typeof enrollmentFlowRenderer.setHostDescription
        >[0] = {
          host,
          text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
        }
        enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_39)
        const nookTypedArgs0_40: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_40)
        return
      }
      if (result.status === 'ambiguous') {
        const nookTypedArgs0_41: Parameters<
          typeof this.showQrCandidatePicker
        >[0] = {
          host,
          section,
          candidates: result.candidates,
        }
        this.showQrCandidatePicker(nookTypedArgs0_41)
        return
      }
      const candidate = result.candidates[0]
      if (!candidate || !candidate.otpauthUri) {
        const nookTypedArgs0_42: Parameters<
          typeof enrollmentFlowRenderer.setHostDescription
        >[0] = {
          host,
          text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
        }
        enrollmentFlowRenderer.setHostDescription(nookTypedArgs0_42)
        const nookTypedArgs0_43: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(nookTypedArgs0_43)
        return
      }
      const uri = { value: candidate.otpauthUri }
      const nookTypedArgs0_44: Parameters<typeof this.showQrPreview>[0] = {
        host,
        section,
        otpauthUri: uri,
        candidate,
      }
      await this.showQrPreview(nookTypedArgs0_44)
    } finally {
      host.setBusy(false)
    }
  }

  enrollmentCeremonyActive(): boolean {
    return this.enrollmentSavePending || this.holdEnrollmentWidgetAfterSave
  }

  enrollmentScanBlocked(): boolean {
    this.holdEnrollmentWidgetAfterSave = false
    return this.enrollmentSavePending
  }

  releaseEnrollmentWidgetHold(): void {
    this.holdEnrollmentWidgetAfterSave = false
  }

  startBackupCodeEnrollment({
    host,
    section = enrollmentFlowRenderer.createEnrollmentSection(host.panel),
  }: StartBackupCodeEnrollmentArgs): void {
    this.releaseEnrollmentWidgetHold()
    const backupHost: BackupEnrollmentHost = {
      ...host,
      returnToActions: () => {
        const actionsContext: Parameters<
          typeof this.renderEnrollmentActions
        >[0] = {
          host,
          hints: this.detectEnrollmentHints(),
        }
        this.renderEnrollmentActions(actionsContext)
      },
    }
    const backupEnrollment: Parameters<
      typeof enrollmentBackupInteraction.startBackupEnrollment
    >[0] = {
      host: backupHost,
      section,
    }
    void enrollmentBackupInteraction.startBackupEnrollment(backupEnrollment)
  }

  renderEnrollmentActions({ host, hints }: RenderEnrollmentActionsArgs): void {
    if (this.enrollmentSavePending) return
    if (!hints.qr && !hints.backupCodes) {
      enrollmentFlowRenderer.clearEnrollmentSection(host.panel)
      return
    }

    const section = enrollmentFlowRenderer.createEnrollmentSection(host.panel)
    const buttons: HTMLButtonElement[] = []

    if (hints.qr) {
      const nookTypedArgs1_10: Parameters<
        typeof enrollmentFlowRenderer.createSecondaryButton
      >[0] = {
        host,
        labelKey: BROWSER_MESSAGE_KEYS.WidgetAddFromPage,
        onClick: (event) => {
          if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
          const enrollmentRequest: ConstructorParameters<
            typeof RevalidatedEnrollmentAction
          >[0] = {
            host,
            action: AuthenticationWorkflowAction.EnrollAuthenticator,
            start: () => {
              const startRequest: Parameters<typeof this.startQrEnrollment>[0] =
                {
                  host,
                  section,
                }
              void this.startQrEnrollment(startRequest)
            },
          }
          void new RevalidatedEnrollmentAction(enrollmentRequest).execute()
        },
      }
      buttons.push(
        enrollmentFlowRenderer.createSecondaryButton(nookTypedArgs1_10),
      )
    }

    if (hints.backupCodes) {
      const nookTypedArgs1_11: Parameters<
        typeof enrollmentFlowRenderer.createSecondaryButton
      >[0] = {
        host,
        labelKey: BROWSER_MESSAGE_KEYS.WidgetSaveBackupCodes,
        onClick: (event) => {
          if (!new AuthenticationGesture(event).trusted || host.isBusy()) return
          const backupRequest: ConstructorParameters<
            typeof RevalidatedEnrollmentAction
          >[0] = {
            host,
            action: AuthenticationWorkflowAction.SaveBackupCodes,
            start: () => {
              const startRequest: Parameters<
                typeof this.startBackupCodeEnrollment
              >[0] = { host, section }
              this.startBackupCodeEnrollment(startRequest)
            },
          }
          void new RevalidatedEnrollmentAction(backupRequest).execute()
        },
      }
      buttons.push(
        enrollmentFlowRenderer.createSecondaryButton(nookTypedArgs1_11),
      )
    }

    const nookTypedArgs0_84: Parameters<
      typeof enrollmentFlowRenderer.appendButtonRow
    >[0] = {
      container: section,
      buttons,
    }
    enrollmentFlowRenderer.appendButtonRow(nookTypedArgs0_84)
  }
}

export const authenticatorEnrollmentInteraction =
  new AuthenticatorEnrollmentInteraction()
