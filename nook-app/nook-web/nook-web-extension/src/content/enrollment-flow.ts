import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
import { pageHasDocumentBackupCodeHint } from '../lib/backup-code-candidates'
import {
  AuthenticatorEnrollmentConfirmResponseKind,
  AuthenticatorEnrollmentStageResponseKind,
  AuthenticatorPreviewResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  clearOtpauthCandidate,
  decodeVisibleOtpauthCandidates,
  pageHasQrEnrollmentHint,
  type DecodedOtpauthCandidate,
} from '../lib/page-qr-capture'
import { isTrustedAuthAction } from '../lib/auth-widget-policy'
import {
  WebsiteAuthenticatorEnrollConfirmMessageType,
  WebsiteAuthenticatorEnrollDismissMessageType,
  WebsiteAuthenticatorEnrollPreviewMessageType,
  WebsiteAuthenticatorEnrollStageMessageType,
} from '../lib/enrollment-messages'
import {
  beginEnrollmentEvidenceWatch,
  enrollmentEvidenceWatchActive,
  fillStagedEnrollmentCode,
  stopPendingEnrollmentWatch,
} from './enrollment-outcome'
import {
  RuntimeMessageDeliveryKind,
  type AuthenticatorBackupAttachResponse,
  type AuthenticatorCodeResponse,
  type AuthenticatorEnrollmentConfirmResponse,
  type AuthenticatorEnrollmentStageResponse,
  type AuthenticatorOptionsResponse,
  type AuthenticatorPreviewResponse,
  type DecodedRuntimeMessageArgs,
  type RuntimeMessageDelivery,
} from './autofill/login-passkey-actions'
import type { AuthenticationOutcomeResponse } from '../lib/outcome-evidence-messages'
import {
  appendButtonRow,
  clearEnrollmentSection,
  createEnrollmentSection,
  createPrimaryButton,
  createSecondaryButton,
  createTextButton,
  renderPreviewDetails,
  setHostDescription,
  type EnrollmentFlowViewHost,
  type EnrollmentPageHints,
} from './enrollment-flow-view'
import {
  type BackupEnrollmentHost,
  startBackupEnrollment,
} from './enrollment-backup-flow'

export type { EnrollmentPageHints } from './enrollment-flow-view'

export function detectEnrollmentHints(): EnrollmentPageHints {
  return {
    qr: pageHasQrEnrollmentHint(),
    backupCodes: pageHasDocumentBackupCodeHint(),
  }
}

type TranslatedMessageWithSubstitutionArgs = {
  key: BrowserMessageKey
  substitution: string
}

export type EnrollmentFlowHost = EnrollmentFlowViewHost & {
  step: HTMLParagraphElement
  continueButton: HTMLButtonElement
  setBusy: (busy: boolean) => void
  isBusy: () => boolean
  sendDecodedRuntimeMessage: <Response>(
    args: DecodedRuntimeMessageArgs<Response>,
  ) => Promise<RuntimeMessageDelivery<Response>>
  sendAuthenticationOutcomeRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticationOutcomeRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticationOutcomeResponse>>
  sendAuthenticatorBackupAttachRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorBackupAttachRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorBackupAttachResponse>>
  sendAuthenticatorCodeRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorCodeRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorCodeResponse>>
  sendAuthenticatorEnrollmentConfirmRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorEnrollmentConfirmRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentConfirmResponse>>
  sendAuthenticatorEnrollmentDismissRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorEnrollmentDismissRuntimeMessage
    >[0],
  ) => Promise<boolean>
  sendAuthenticatorEnrollmentStageRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorEnrollmentStageRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorEnrollmentStageResponse>>
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
  sendRuntimeMessageWithoutResponse: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendRuntimeMessageWithoutResponse
    >[0],
  ) => void
  requestWorkflowReclassification: () => void
  translatedMessage: (key: BrowserMessageKey) => string
  translatedMessageWithSubstitution: (
    args: TranslatedMessageWithSubstitutionArgs,
  ) => string
}

enum EnrollmentWidgetHoldKind {
  Idle = 'idle',
  Held = 'held',
}

export type EnrollmentWidgetHold =
  | { kind: EnrollmentWidgetHoldKind.Idle }
  | {
      kind: EnrollmentWidgetHoldKind.Held
      host: EnrollmentFlowHost
    }

/** Keep the post-save confirmation while Rust classifies the next action. */
let enrollmentWidgetHold: EnrollmentWidgetHold = {
  kind: EnrollmentWidgetHoldKind.Idle,
}

enum ActiveEnrollmentCeremonyKind {
  Idle = 'idle',
  Pending = 'pending',
  Staged = 'staged',
}

type ActiveEnrollmentCeremony =
  | { kind: ActiveEnrollmentCeremonyKind.Idle }
  | {
      kind: ActiveEnrollmentCeremonyKind.Pending
      authorizationGeneration: number
      host: EnrollmentFlowHost
    }
  | {
      kind: ActiveEnrollmentCeremonyKind.Staged
      authorizationGeneration: number
      host: EnrollmentFlowHost
      stageId: string
    }

let enrollmentAuthorizationGeneration = 0
let activeEnrollmentCeremony: ActiveEnrollmentCeremony = {
  kind: ActiveEnrollmentCeremonyKind.Idle,
}

function beginActiveEnrollmentCeremony(host: EnrollmentFlowHost): number {
  enrollmentAuthorizationGeneration += 1
  activeEnrollmentCeremony = {
    kind: ActiveEnrollmentCeremonyKind.Pending,
    authorizationGeneration: enrollmentAuthorizationGeneration,
    host,
  }
  return enrollmentAuthorizationGeneration
}

function enrollmentCeremonyIsCurrent(authorizationGeneration: number): boolean {
  return (
    activeEnrollmentCeremony.kind !== ActiveEnrollmentCeremonyKind.Idle &&
    activeEnrollmentCeremony.authorizationGeneration === authorizationGeneration
  )
}

type AssignStagedEnrollmentCeremonyArgs = {
  authorizationGeneration: number
  host: EnrollmentFlowHost
  stageId: string
}

function assignStagedEnrollmentCeremony({
  authorizationGeneration,
  host,
  stageId,
}: AssignStagedEnrollmentCeremonyArgs): boolean {
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return false
  activeEnrollmentCeremony = {
    kind: ActiveEnrollmentCeremonyKind.Staged,
    authorizationGeneration,
    host,
    stageId,
  }
  return true
}

function completeEnrollmentCeremony(authorizationGeneration: number): void {
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return
  activeEnrollmentCeremony = { kind: ActiveEnrollmentCeremonyKind.Idle }
}

type DismissStagedEnrollmentArgs = {
  host: EnrollmentFlowHost
  stageId: string
}

async function dismissStagedEnrollment({
  host,
  stageId,
}: DismissStagedEnrollmentArgs): Promise<void> {
  const message: Parameters<
    typeof host.sendAuthenticatorEnrollmentDismissRuntimeMessage
  >[0] = {
    type: WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss,
    payload: { origin: location.origin, stageId },
  }
  await host.sendAuthenticatorEnrollmentDismissRuntimeMessage(message)
}

export async function cancelActiveEnrollmentCeremony(): Promise<void> {
  enrollmentAuthorizationGeneration += 1
  enrollmentWidgetHold = { kind: EnrollmentWidgetHoldKind.Idle }
  stopPendingEnrollmentWatch()
  const ceremony = activeEnrollmentCeremony
  activeEnrollmentCeremony = { kind: ActiveEnrollmentCeremonyKind.Idle }
  if (ceremony.kind !== ActiveEnrollmentCeremonyKind.Staged) return
  const dismissArgs: Parameters<typeof dismissStagedEnrollment>[0] = {
    host: ceremony.host,
    stageId: ceremony.stageId,
  }
  await dismissStagedEnrollment(dismissArgs)
}

function requestFreshEnrollmentActions(host: EnrollmentFlowHost): void {
  clearEnrollmentSection(host.panel)
  host.requestWorkflowReclassification()
}

type CommitStagedEnrollmentArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  stageId: string
  vaultStoreId: string
  authorizationGeneration: number
}

async function commitStagedEnrollment({
  host,
  section,
  stageId,
  vaultStoreId,
  authorizationGeneration,
}: CommitStagedEnrollmentArgs): Promise<void> {
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return
  // The evidence watch is stopped before this async commit begins. Hold the
  // current widget across that gap so a success-page rescan cannot remove it.
  enrollmentWidgetHold = {
    kind: EnrollmentWidgetHoldKind.Held,
    host,
  }
  const nookTypedArgs0_0: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  }
  setHostDescription(nookTypedArgs0_0)
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
  const confirmDelivery =
    await host.sendAuthenticatorEnrollmentConfirmRuntimeMessage(confirmMessage)
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return
  if (
    confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
    confirmDelivery.response.kind ===
      AuthenticatorEnrollmentConfirmResponseKind.Completed
  ) {
    completeEnrollmentCeremony(authorizationGeneration)
    const nookTypedArgs0_1: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollSaved),
    }
    setHostDescription(nookTypedArgs0_1)
    host.requestWorkflowReclassification()
  } else if (
    confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
    confirmDelivery.response.kind ===
      AuthenticatorEnrollmentConfirmResponseKind.Rejected &&
    'reason' in confirmDelivery.response &&
    confirmDelivery.response.reason === 'authenticator-locked'
  ) {
    completeEnrollmentCeremony(authorizationGeneration)
    enrollmentWidgetHold = { kind: EnrollmentWidgetHoldKind.Idle }
    const nookTypedArgs0_3: Parameters<typeof setHostDescription>[0] = {
      host,
      text: lockedEnrollMessage(host),
    }
    setHostDescription(nookTypedArgs0_3)
  } else {
    completeEnrollmentCeremony(authorizationGeneration)
    enrollmentWidgetHold = { kind: EnrollmentWidgetHoldKind.Idle }
    const nookTypedArgs0_4: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    }
    setHostDescription(nookTypedArgs0_4)
  }
  host.setBusy(false)
  section.replaceChildren()
}

type EnrollmentEvidenceCallbacksArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  stageId: string
  vaultStoreId: string
  authorizationGeneration: number
}

function enrollmentEvidenceCallbacks({
  host,
  section,
  stageId,
  vaultStoreId,
  authorizationGeneration,
}: EnrollmentEvidenceCallbacksArgs) {
  return {
    commit: () => {
      const nookArrowArgs0: Parameters<typeof commitStagedEnrollment>[0] = {
        host,
        section,
        stageId,
        vaultStoreId,
        authorizationGeneration,
      }
      return commitStagedEnrollment(nookArrowArgs0)
    },
    reject: () => {
      const nookTypedArgs0_5: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      }
      setHostDescription(nookTypedArgs0_5)
      host.setBusy(true)
      void cancelActiveEnrollmentCeremony().finally(() => {
        host.setBusy(false)
        requestFreshEnrollmentActions(host)
      })
    },
    timeout: () => {
      // Keep the staged secret; ask the user to finish verification or cancel.
      const nookTypedArgs0_7: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending,
        ),
      }
      setHostDescription(nookTypedArgs0_7)
    },
  }
}

type BeginEnrollmentCeremonyArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  vaultStoreId: string
  otpauthUri: { value: string }
  candidate: DecodedOtpauthCandidate
}

async function beginEnrollmentCeremony({
  host,
  section,
  vaultStoreId,
  otpauthUri,
  candidate,
}: BeginEnrollmentCeremonyArgs): Promise<void> {
  const authorizationGeneration = beginActiveEnrollmentCeremony(host)
  enrollmentWidgetHold = { kind: EnrollmentWidgetHoldKind.Idle }
  const nookTypedArgs0_8: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollStaging),
  }
  setHostDescription(nookTypedArgs0_8)
  // Arm the watch early so fill-driven mutations cannot re-scan and wipe the UI.
  const nookTypedArgs0_9: Parameters<typeof enrollmentEvidenceCallbacks>[0] = {
    host,
    section,
    stageId: 'pending',
    vaultStoreId,
    authorizationGeneration,
  }
  const nookTypedArgs1_0: Parameters<typeof beginEnrollmentEvidenceWatch>[0] = {
    host,
    stageId: 'pending',
    callbacks: enrollmentEvidenceCallbacks(nookTypedArgs0_9),
  }
  beginEnrollmentEvidenceWatch(nookTypedArgs1_0)
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
  const stageDelivery =
    await host.sendAuthenticatorEnrollmentStageRuntimeMessage(message)
  clearOtpauthUri(otpauthUri)
  clearCandidate(candidate)
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) {
    if (
      stageDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
      stageDelivery.response.kind ===
        AuthenticatorEnrollmentStageResponseKind.Staged &&
      'stageId' in stageDelivery.response
    ) {
      const dismissArgs: Parameters<typeof dismissStagedEnrollment>[0] = {
        host,
        stageId: stageDelivery.response.stageId,
      }
      await dismissStagedEnrollment(dismissArgs)
    }
    return
  }
  if (stageDelivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    stopPendingEnrollmentWatch()
    completeEnrollmentCeremony(authorizationGeneration)
    const nookTypedArgs0_10: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    }
    setHostDescription(nookTypedArgs0_10)
    host.setBusy(false)
    requestFreshEnrollmentActions(host)
    return
  }
  const { response: stageResponse } = stageDelivery
  if (
    stageResponse.kind !== AuthenticatorEnrollmentStageResponseKind.Staged ||
    !('stageId' in stageResponse)
  ) {
    stopPendingEnrollmentWatch()
    completeEnrollmentCeremony(authorizationGeneration)
    const nookTypedArgs0_12: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
    }
    setHostDescription(nookTypedArgs0_12)
    host.setBusy(false)
    requestFreshEnrollmentActions(host)
    return
  }
  const stageId = stageResponse.stageId
  const stagedCeremony: Parameters<typeof assignStagedEnrollmentCeremony>[0] = {
    authorizationGeneration,
    host,
    stageId,
  }
  if (!assignStagedEnrollmentCeremony(stagedCeremony)) return
  // Replace the temporary pending watch with the real stage id.
  const nookTypedArgs0_14: Parameters<typeof enrollmentEvidenceCallbacks>[0] = {
    host,
    section,
    stageId,
    vaultStoreId,
    authorizationGeneration,
  }
  const nookTypedArgs1_1: Parameters<typeof beginEnrollmentEvidenceWatch>[0] = {
    host,
    stageId,
    callbacks: enrollmentEvidenceCallbacks(nookTypedArgs0_14),
  }
  beginEnrollmentEvidenceWatch(nookTypedArgs1_1)

  const nookTypedArgs0_15: Parameters<typeof fillStagedEnrollmentCode>[0] = {
    host,
    stageId,
  }
  const filled = await fillStagedEnrollmentCode(nookTypedArgs0_15)
  const nookTypedArgs0_16: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(
      filled
        ? BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyFilled
        : BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending,
    ),
  }
  setHostDescription(nookTypedArgs0_16)
  section.replaceChildren()
  const nookTypedArgs1_2: Parameters<typeof createTextButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      host.setBusy(true)
      void cancelActiveEnrollmentCeremony().finally(() => {
        host.setBusy(false)
        requestFreshEnrollmentActions(host)
      })
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_2)
  section.append(cancelButton)
  host.setBusy(false)
}

type ClearOtpauthUriArgs = { value: string }

function clearOtpauthUri(uri: ClearOtpauthUriArgs): void {
  uri.value = ''
}

function clearCandidate(candidate: DecodedOtpauthCandidate): void {
  clearOtpauthCandidate(candidate)
}

function unavailableMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
}

function lockedEnrollMessage(host: EnrollmentFlowHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock)
}

type ShowQrPreviewArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  otpauthUri: { value: string }
  candidate: DecodedOtpauthCandidate
}

async function showQrPreview({
  host,
  section,
  otpauthUri,
  candidate,
}: ShowQrPreviewArgs): Promise<void> {
  section.replaceChildren()
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetEnrollPreview,
  )
  const nookTypedArgs0_19: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  }
  setHostDescription(nookTypedArgs0_19)
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
    const delivery = await host.sendAuthenticatorPreviewRuntimeMessage(message)

    if (
      delivery.kind === RuntimeMessageDeliveryKind.Unavailable ||
      delivery.response.kind === AuthenticatorPreviewResponseKind.Rejected
    ) {
      const nookTypedArgs0_20: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollFailed),
      }
      setHostDescription(nookTypedArgs0_20)
      requestFreshEnrollmentActions(host)
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
      return
    }
    const { response } = delivery

    if (response.kind === AuthenticatorPreviewResponseKind.Unavailable) {
      const nookTypedArgs0_22: Parameters<typeof setHostDescription>[0] = {
        host,
        text: unavailableMessage(host),
      }
      setHostDescription(nookTypedArgs0_22)
      requestFreshEnrollmentActions(host)
      clearOtpauthUri(otpauthUri)
      clearCandidate(candidate)
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

    const nookTypedArgs0_26: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollPreview),
    }
    setHostDescription(nookTypedArgs0_26)
    const nookTypedArgs0_27: Parameters<typeof renderPreviewDetails>[0] = {
      container: section,
      host,
      preview,
    }
    renderPreviewDetails(nookTypedArgs0_27)

    const nookTypedArgs1_3: Parameters<typeof createPrimaryButton>[0] = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollConfirm,
      onClick: (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        host.setBusy(true)
        confirmButton.disabled = true
        cancelButton.disabled = true
        const nookTypedArgs0_28: Parameters<typeof beginEnrollmentCeremony>[0] =
          {
            host,
            section,
            vaultStoreId,
            otpauthUri,
            candidate,
          }
        void beginEnrollmentCeremony(nookTypedArgs0_28)
      },
    }
    const confirmButton = createPrimaryButton(nookTypedArgs1_3)

    const nookTypedArgs1_4: Parameters<typeof createTextButton>[0] = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
      onClick: (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        clearOtpauthUri(otpauthUri)
        clearCandidate(candidate)
        requestFreshEnrollmentActions(host)
      },
    }
    const cancelButton = createTextButton(nookTypedArgs1_4)

    const nookTypedArgs0_31: Parameters<typeof appendButtonRow>[0] = {
      container: section,
      buttons: [confirmButton, cancelButton],
    }
    appendButtonRow(nookTypedArgs0_31)
  } finally {
    host.setBusy(false)
  }
}

type ShowQrCandidatePickerArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  candidates: DecodedOtpauthCandidate[]
}

function showQrCandidatePicker({
  host,
  section,
  candidates,
}: ShowQrCandidatePickerArgs): void {
  section.replaceChildren()
  const nookTypedArgs0_32: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollAmbiguous),
  }
  setHostDescription(nookTypedArgs0_32)
  const list = document.createElement('div')
  list.className = 'account-list'
  candidates.forEach((candidate) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    button.textContent = candidate.sourceLabel
    button.setAttribute('aria-label', candidate.sourceLabel)
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      const uri = { value: candidate.otpauthUri }
      const nookTypedArgs0_33: Parameters<typeof showQrPreview>[0] = {
        host,
        section,
        otpauthUri: uri,
        candidate,
      }
      void showQrPreview(nookTypedArgs0_33)
    })
    list.append(button)
  })
  section.append(list)
  const nookTypedArgs1_5: Parameters<typeof createTextButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetEnrollCancel,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      candidates.forEach((candidate) => clearCandidate(candidate))
      requestFreshEnrollmentActions(host)
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_5)
  section.append(cancelButton)
}

type StartQrEnrollmentArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
}

async function startQrEnrollment({
  host,
  section,
}: StartQrEnrollmentArgs): Promise<void> {
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetEnrollTitle,
  )
  const nookTypedArgs0_36: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollWorking),
  }
  setHostDescription(nookTypedArgs0_36)
  host.setBusy(true)
  section.replaceChildren()

  try {
    const result = await decodeVisibleOtpauthCandidates()
    if (result.status === 'unsupported') {
      const nookTypedArgs0_37: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollUnsupported,
        ),
      }
      setHostDescription(nookTypedArgs0_37)
      requestFreshEnrollmentActions(host)
      return
    }
    if (result.status === 'empty') {
      const nookTypedArgs0_39: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
      }
      setHostDescription(nookTypedArgs0_39)
      requestFreshEnrollmentActions(host)
      return
    }
    if (result.status === 'ambiguous') {
      const nookTypedArgs0_41: Parameters<typeof showQrCandidatePicker>[0] = {
        host,
        section,
        candidates: result.candidates,
      }
      showQrCandidatePicker(nookTypedArgs0_41)
      return
    }
    const candidate = result.candidates[0]
    if (!candidate || !candidate.otpauthUri) {
      const nookTypedArgs0_42: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
      }
      setHostDescription(nookTypedArgs0_42)
      requestFreshEnrollmentActions(host)
      return
    }
    const uri = { value: candidate.otpauthUri }
    const nookTypedArgs0_44: Parameters<typeof showQrPreview>[0] = {
      host,
      section,
      otpauthUri: uri,
      candidate,
    }
    await showQrPreview(nookTypedArgs0_44)
  } finally {
    host.setBusy(false)
  }
}

export function enrollmentCeremonyActive(): boolean {
  return enrollmentEvidenceWatchActive()
}

export function enrollmentWidgetHeldAfterSave(): EnrollmentWidgetHold {
  return enrollmentWidgetHold
}

export function releaseEnrollmentWidgetHold(): void {
  enrollmentWidgetHold = { kind: EnrollmentWidgetHoldKind.Idle }
}

type RenderEnrollmentActionsArgs = {
  host: EnrollmentFlowHost
  hints: EnrollmentPageHints
}

export function renderEnrollmentActions({
  host,
  hints,
}: RenderEnrollmentActionsArgs): void {
  if (enrollmentEvidenceWatchActive()) return
  if (!hints.qr && !hints.backupCodes) {
    clearEnrollmentSection(host.panel)
    return
  }

  const section = createEnrollmentSection(host.panel)
  const buttons: HTMLButtonElement[] = []

  if (hints.qr) {
    const nookTypedArgs1_10: Parameters<typeof createSecondaryButton>[0] = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetAddFromPage,
      onClick: (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        releaseEnrollmentWidgetHold()
        const nookTypedArgs0_82: Parameters<typeof startQrEnrollment>[0] = {
          host,
          section,
        }
        void startQrEnrollment(nookTypedArgs0_82)
      },
    }
    buttons.push(createSecondaryButton(nookTypedArgs1_10))
  }

  if (hints.backupCodes) {
    const nookTypedArgs1_11: Parameters<typeof createSecondaryButton>[0] = {
      host,
      labelKey: BROWSER_MESSAGE_KEYS.WidgetSaveBackupCodes,
      onClick: (event) => {
        if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
        releaseEnrollmentWidgetHold()
        const backupHost: BackupEnrollmentHost = {
          ...host,
          returnToActions: () => {
            requestFreshEnrollmentActions(host)
          },
        }
        const backupEnrollment: Parameters<typeof startBackupEnrollment>[0] = {
          host: backupHost,
          section,
        }
        void startBackupEnrollment(backupEnrollment)
      },
    }
    buttons.push(createSecondaryButton(nookTypedArgs1_11))
  }

  const nookTypedArgs0_84: Parameters<typeof appendButtonRow>[0] = {
    container: section,
    buttons,
  }
  appendButtonRow(nookTypedArgs0_84)
}
