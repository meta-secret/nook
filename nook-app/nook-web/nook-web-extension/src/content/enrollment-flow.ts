import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
import {
  authenticationRecoveryEvidence,
  recoveryCopyHasBackupCodeHint,
} from '../lib/backup-code-candidates'
import {
  AuthenticationWorkflowAction,
  AuthenticatorEnrollmentConfirmResponseKind,
  AuthenticatorEnrollmentStageResponseKind,
  AuthenticatorPreviewResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { EnrollmentRevokeOutcome } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
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
  renderEnrollmentCancelRetry,
  renderPreviewDetails,
  setHostDescription,
  type EnrollmentFlowViewHost,
  type EnrollmentPageHints,
} from './enrollment-flow-view'
import {
  type BackupEnrollmentHost,
  startBackupEnrollment,
} from './enrollment-backup-flow'
import { startRevalidatedEnrollmentAction } from './autofill/backup-code-workflow-action'

export type { EnrollmentPageHints } from './enrollment-flow-view'

export function detectEnrollmentHints(): EnrollmentPageHints {
  const [copy, backupCodes] = authenticationRecoveryEvidence()
  const hints = detectEnrollmentHintsFromRecoveryCopy(copy)
  hints.backupCodes = backupCodes
  return hints
}

export function detectEnrollmentHintsFromRecoveryCopy(
  recoveryCopy: string,
): EnrollmentPageHints {
  return {
    qr: pageHasQrEnrollmentHint(),
    backupCodes: recoveryCopyHasBackupCodeHint(recoveryCopy),
  }
}

type TranslatedMessageWithSubstitutionArgs = {
  key: BrowserMessageKey
  substitution: string
}

export type EnrollmentFlowHost = EnrollmentFlowViewHost & {
  step: HTMLParagraphElement
  continueButton: HTMLButtonElement
  openVaultButton: HTMLButtonElement
  requestWorkflowReclassification: () => void
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
  ) => Promise<EnrollmentRevokeOutcome>
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
  translatedMessage: (key: BrowserMessageKey) => string
  translatedMessageWithSubstitution: (
    args: TranslatedMessageWithSubstitutionArgs,
  ) => string
}

let holdEnrollmentWidgetAfterSave = false

enum ActiveEnrollmentCeremonyKind {
  Idle = 'idle',
  Pending = 'pending',
  Staged = 'staged',
  CancellationPending = 'cancellation-pending',
}

type ActiveEnrollmentCeremony =
  | { kind: ActiveEnrollmentCeremonyKind.Idle }
  | {
      kind: ActiveEnrollmentCeremonyKind.Pending
      authorizationGeneration: number
      host: EnrollmentFlowHost
      section: HTMLElement
      stageId: string
      sensitiveMaterial: PendingEnrollmentSensitiveMaterial
    }
  | {
      kind:
        | ActiveEnrollmentCeremonyKind.Staged
        | ActiveEnrollmentCeremonyKind.CancellationPending
      authorizationGeneration: number
      host: EnrollmentFlowHost
      section: HTMLElement
      stageId: string
    }

let enrollmentAuthorizationGeneration = 0
let activeEnrollmentCeremony: ActiveEnrollmentCeremony = {
  kind: ActiveEnrollmentCeremonyKind.Idle,
}

type BeginActiveEnrollmentCeremonyArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
  stageId: string
  sensitiveMaterial: PendingEnrollmentSensitiveMaterial
}

export function beginActiveEnrollmentCeremony({
  host,
  section,
  stageId,
  sensitiveMaterial,
}: BeginActiveEnrollmentCeremonyArgs): number {
  enrollmentAuthorizationGeneration += 1
  activeEnrollmentCeremony = {
    kind: ActiveEnrollmentCeremonyKind.Pending,
    authorizationGeneration: enrollmentAuthorizationGeneration,
    host,
    section,
    stageId,
    sensitiveMaterial,
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
  section: HTMLElement
  stageId: string
}

export function assignStagedEnrollmentCeremony({
  authorizationGeneration,
  host,
  section,
  stageId,
}: AssignStagedEnrollmentCeremonyArgs): boolean {
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return false
  activeEnrollmentCeremony = {
    kind: ActiveEnrollmentCeremonyKind.Staged,
    authorizationGeneration,
    host,
    section,
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
}: DismissStagedEnrollmentArgs): Promise<boolean> {
  const message: Parameters<
    typeof host.sendAuthenticatorEnrollmentDismissRuntimeMessage
  >[0] = {
    type: WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss,
    payload: { origin: location.origin, stageId },
  }
  try {
    const outcome =
      await host.sendAuthenticatorEnrollmentDismissRuntimeMessage(message)
    return (
      outcome === EnrollmentRevokeOutcome.Revoked ||
      outcome === EnrollmentRevokeOutcome.Missing
    )
  } catch {
    return false
  }
}

export async function cancelActiveEnrollmentCeremony(): Promise<boolean> {
  holdEnrollmentWidgetAfterSave = false
  stopPendingEnrollmentWatch()
  const ceremony = activeEnrollmentCeremony
  if (ceremony.kind === ActiveEnrollmentCeremonyKind.Idle) return true
  if (ceremony.kind === ActiveEnrollmentCeremonyKind.CancellationPending)
    return false
  if (ceremony.kind === ActiveEnrollmentCeremonyKind.Pending)
    clearPendingEnrollmentSensitiveMaterial(ceremony.sensitiveMaterial)
  const cancellationGeneration = ceremony.authorizationGeneration
  activeEnrollmentCeremony = {
    kind: ActiveEnrollmentCeremonyKind.CancellationPending,
    authorizationGeneration: cancellationGeneration,
    host: ceremony.host,
    section: ceremony.section,
    stageId: ceremony.stageId,
  }
  const dismissArgs: Parameters<typeof dismissStagedEnrollment>[0] = {
    host: ceremony.host,
    stageId: ceremony.stageId,
  }
  const dismissed = await dismissStagedEnrollment(dismissArgs)
  if (!enrollmentCeremonyIsCurrent(cancellationGeneration)) return false
  if (dismissed) enrollmentAuthorizationGeneration += 1
  activeEnrollmentCeremony = dismissed
    ? { kind: ActiveEnrollmentCeremonyKind.Idle }
    : {
        kind: ActiveEnrollmentCeremonyKind.Staged,
        authorizationGeneration: cancellationGeneration,
        host: ceremony.host,
        section: ceremony.section,
        stageId: ceremony.stageId,
      }
  if (!dismissed) {
    ceremony.host.description.textContent = ceremony.host.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
    )
    renderEnrollmentCancelRetry({
      host: ceremony.host,
      section: ceremony.section,
      cancel: cancelActiveEnrollmentCeremony,
    })
  }
  return dismissed
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
    if (detectEnrollmentHints().backupCodes) {
      const nookTypedArgs0_2: Parameters<typeof renderEnrollmentActions>[0] = {
        host,
        hints: detectEnrollmentHints(),
      }
      renderEnrollmentActions(nookTypedArgs0_2)
    }
    holdEnrollmentWidgetAfterSave = true
  } else if (
    confirmDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
    confirmDelivery.response.kind ===
      AuthenticatorEnrollmentConfirmResponseKind.Rejected &&
    'reason' in confirmDelivery.response &&
    confirmDelivery.response.reason === 'authenticator-locked'
  ) {
    completeEnrollmentCeremony(authorizationGeneration)
    const nookTypedArgs0_3: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock),
    }
    setHostDescription(nookTypedArgs0_3)
  } else {
    completeEnrollmentCeremony(authorizationGeneration)
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

function enrollmentEvidenceCallbacks(args: EnrollmentEvidenceCallbacksArgs) {
  const { host, section, stageId, vaultStoreId, authorizationGeneration } = args
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
      host.description.textContent = host.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
      )
      host.setBusy(true)
      void cancelActiveEnrollmentCeremony().then((dismissed) => {
        if (!dismissed && !enrollmentCeremonyIsCurrent(authorizationGeneration))
          return
        host.setBusy(false)
        if (dismissed) {
          renderEnrollmentRetryActions(host)
          return
        }
        host.description.textContent = host.translatedMessage(
          BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
        )
      })
    },
    expired: () => {
      if (enrollmentCeremonyIsCurrent(authorizationGeneration))
        renderEnrollmentStageFailure(args)
    },
    timeout: () => {
      host.description.textContent = host.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending,
      )
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
type PendingEnrollmentSensitiveMaterial = {
  uri: { value: string }
  payload: { otpauthUri: string }
  candidate: DecodedOtpauthCandidate
}
function clearPendingEnrollmentSensitiveMaterial(
  material: PendingEnrollmentSensitiveMaterial,
): void {
  material.uri.value = ''
  material.payload.otpauthUri = ''
  clearOtpauthCandidate(material.candidate)
}
function renderEnrollmentStageFailure(
  args: EnrollmentEvidenceCallbacksArgs,
): void {
  const { host, authorizationGeneration } = args
  stopPendingEnrollmentWatch()
  completeEnrollmentCeremony(authorizationGeneration)
  host.description.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
  )
  host.setBusy(false)
  renderEnrollmentRetryActions(host)
}
export async function beginEnrollmentCeremony({
  host,
  section,
  vaultStoreId,
  otpauthUri,
  candidate,
}: BeginEnrollmentCeremonyArgs): Promise<void> {
  const stageId = crypto.randomUUID()
  const message: Parameters<
    typeof host.sendAuthenticatorEnrollmentStageRuntimeMessage
  >[0] = {
    type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage,
    payload: {
      origin: location.origin,
      stageId,
      vaultStoreId,
      otpauthUri: otpauthUri.value,
    },
  }
  const sensitiveMaterial: PendingEnrollmentSensitiveMaterial = {
    uri: otpauthUri,
    payload: message.payload,
    candidate,
  }
  const beginArgs: BeginActiveEnrollmentCeremonyArgs = {
    host,
    section,
    stageId,
    sensitiveMaterial,
  }
  const dismissArgs: DismissStagedEnrollmentArgs = { host, stageId }
  const authorizationGeneration = beginActiveEnrollmentCeremony(beginArgs)
  holdEnrollmentWidgetAfterSave = false
  const nookTypedArgs0_8: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollStaging),
  }
  setHostDescription(nookTypedArgs0_8)
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
  const stageDelivery =
    await host.sendAuthenticatorEnrollmentStageRuntimeMessage(message)
  clearPendingEnrollmentSensitiveMaterial(sensitiveMaterial)
  if (
    activeEnrollmentCeremony.kind !== ActiveEnrollmentCeremonyKind.Pending ||
    activeEnrollmentCeremony.authorizationGeneration !== authorizationGeneration
  ) {
    if (
      stageDelivery.kind === RuntimeMessageDeliveryKind.Delivered &&
      stageDelivery.response.kind ===
        AuthenticatorEnrollmentStageResponseKind.Staged &&
      'stageId' in stageDelivery.response
    ) {
      await dismissStagedEnrollment(dismissArgs)
    }
    return
  }
  if (stageDelivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
    renderEnrollmentStageFailure(nookTypedArgs0_9)
    return
  }
  const { response: stageResponse } = stageDelivery
  const stagedResponse =
    stageResponse.kind === AuthenticatorEnrollmentStageResponseKind.Staged &&
    'stageId' in stageResponse
  const stagedCeremony: Parameters<typeof assignStagedEnrollmentCeremony>[0] = {
    authorizationGeneration,
    host,
    section,
    stageId,
  }
  let mismatchedStageRetained = false
  if (stagedResponse && stageResponse.stageId !== stageId) {
    const dismissed = await dismissStagedEnrollment(dismissArgs)
    if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return
    if (!dismissed)
      mismatchedStageRetained = assignStagedEnrollmentCeremony(stagedCeremony)
  }
  if (!stagedResponse || stageResponse.stageId !== stageId) {
    if (mismatchedStageRetained) {
      stopPendingEnrollmentWatch()
      host.description.textContent = host.translatedMessage(
        BROWSER_MESSAGE_KEYS.WidgetEnrollFailed,
      )
      renderEnrollmentCancelRetry({
        host,
        section,
        cancel: cancelActiveEnrollmentCeremony,
      })
      return
    }
    renderEnrollmentStageFailure(nookTypedArgs0_9)
    return
  }
  if (!assignStagedEnrollmentCeremony(stagedCeremony)) return
  const nookTypedArgs0_14: Parameters<typeof enrollmentEvidenceCallbacks>[0] &
    Parameters<typeof renderEnrollmentCancelRetry>[0] = {
    host,
    section,
    cancel: cancelActiveEnrollmentCeremony,
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
    authorizationIsCurrent: () =>
      enrollmentCeremonyIsCurrent(authorizationGeneration),
  }
  const filled = await fillStagedEnrollmentCode(nookTypedArgs0_15)
  if (!enrollmentCeremonyIsCurrent(authorizationGeneration)) return
  const nookTypedArgs0_16: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(
      filled
        ? BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyFilled
        : BROWSER_MESSAGE_KEYS.WidgetEnrollVerifyPending,
    ),
  }
  setHostDescription(nookTypedArgs0_16)
  renderEnrollmentCancelRetry(nookTypedArgs0_14)
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
      renderEnrollmentRetryActions(host)
      otpauthUri.value = ''
      clearOtpauthCandidate(candidate)
      return
    }
    const { response } = delivery

    if (response.kind === AuthenticatorPreviewResponseKind.Unavailable) {
      const nookTypedArgs0_22: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault),
      }
      setHostDescription(nookTypedArgs0_22)
      renderEnrollmentRetryActions(host)
      otpauthUri.value = ''
      clearOtpauthCandidate(candidate)
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
        otpauthUri.value = ''
        clearOtpauthCandidate(candidate)
        clearEnrollmentSection(host.panel)
        host.requestWorkflowReclassification()
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
      candidates.forEach((candidate) => clearOtpauthCandidate(candidate))
      clearEnrollmentSection(host.panel)
      host.requestWorkflowReclassification()
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_5)
  section.append(cancelButton)
}

type StartQrEnrollmentArgs = {
  host: EnrollmentFlowHost
  section: HTMLElement
}

export async function startQrEnrollment({
  host,
  section,
}: StartQrEnrollmentArgs): Promise<void> {
  releaseEnrollmentWidgetHold()
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
      renderEnrollmentRetryActions(host)
      return
    }
    if (result.status === 'empty') {
      const nookTypedArgs0_39: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollNoQr),
      }
      setHostDescription(nookTypedArgs0_39)
      renderEnrollmentRetryActions(host)
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
      renderEnrollmentRetryActions(host)
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
  return (
    activeEnrollmentCeremony.kind !== ActiveEnrollmentCeremonyKind.Idle ||
    enrollmentEvidenceWatchActive() ||
    holdEnrollmentWidgetAfterSave
  )
}

export function releaseEnrollmentWidgetHold(): void {
  holdEnrollmentWidgetAfterSave = false
}

type RenderEnrollmentActionsArgs = {
  host: EnrollmentFlowHost
  hints: EnrollmentPageHints
}

export function renderEnrollmentRetryActions(host: EnrollmentFlowHost): void {
  const retry: Parameters<typeof renderEnrollmentActions>[0] = {
    host,
    hints: detectEnrollmentHints(),
  }
  renderEnrollmentActions(retry)
}

type StartBackupCodeEnrollmentArgs = {
  host: EnrollmentFlowHost
  section?: HTMLElement
}

/** Begin recovery-code extraction only after the trusted action has been approved. */
export function startBackupCodeEnrollment({
  host,
  section = createEnrollmentSection(host.panel),
}: StartBackupCodeEnrollmentArgs): void {
  releaseEnrollmentWidgetHold()
  const backupHost: BackupEnrollmentHost = {
    ...host,
    returnToActions: () => {
      const actionsContext: Parameters<typeof renderEnrollmentActions>[0] = {
        host,
        hints: detectEnrollmentHints(),
      }
      renderEnrollmentActions(actionsContext)
    },
  }
  const backupEnrollment: Parameters<typeof startBackupEnrollment>[0] = {
    host: backupHost,
    section,
  }
  void startBackupEnrollment(backupEnrollment)
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
        const enrollmentRequest: Parameters<
          typeof startRevalidatedEnrollmentAction
        >[0] = {
          host,
          action: AuthenticationWorkflowAction.EnrollAuthenticator,
          start: () => {
            const startRequest: Parameters<typeof startQrEnrollment>[0] = {
              host,
              section,
            }
            void startQrEnrollment(startRequest)
          },
        }
        void startRevalidatedEnrollmentAction(enrollmentRequest)
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
        const backupRequest: Parameters<
          typeof startRevalidatedEnrollmentAction
        >[0] = {
          host,
          action: AuthenticationWorkflowAction.SaveBackupCodes,
          start: () => {
            const startRequest: Parameters<
              typeof startBackupCodeEnrollment
            >[0] = { host, section }
            startBackupCodeEnrollment(startRequest)
          },
        }
        void startRevalidatedEnrollmentAction(backupRequest)
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
