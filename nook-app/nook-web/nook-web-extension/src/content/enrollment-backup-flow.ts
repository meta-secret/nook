import {
  BROWSER_MESSAGE_KEYS,
  type BrowserMessageKey,
} from '../lib/browser-message-keys'
import {
  clearBackupCodeCandidates,
  extractBackupCodeCandidates,
  pageHasBackupCodeHint,
} from '../lib/backup-code-candidates'
import { pageHasQrEnrollmentHint } from '../lib/page-qr-capture'
import {
  AuthenticatorBackupAttachResponseKind,
  AuthenticatorOptionsResponseKind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  isTrustedAuthAction,
  safeSavedOptionNumber,
} from '../lib/auth-widget-policy'
import type { WebsiteAuthenticatorOption } from '../lib/login-fill-messages'
import { WebsiteAuthenticatorOptionsMessageType } from '../lib/login-fill-messages'
import { WebsiteAuthenticatorBackupAttachMessageType } from '../lib/enrollment-messages'
import {
  RuntimeMessageDeliveryKind,
  type AuthenticatorBackupAttachResponse,
  type AuthenticatorOptionsResponse,
  type DecodedRuntimeMessageArgs,
  type RuntimeMessageDelivery,
} from './autofill/login-passkey-actions'
import {
  appendButtonRow,
  createPrimaryButton,
  createSecondaryButton,
  createTextButton,
  resetEnrollmentHeadline,
  setHostDescription,
  type EnrollmentFlowViewHost,
  type EnrollmentPageHints,
} from './enrollment-flow-view'

export interface BackupEnrollmentHost extends EnrollmentFlowViewHost {
  setBusy: (busy: boolean) => void
  isBusy: () => boolean
  sendDecodedRuntimeMessage: <Response>(
    args: DecodedRuntimeMessageArgs<Response>,
  ) => Promise<RuntimeMessageDelivery<Response>>
  sendAuthenticatorBackupAttachRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorBackupAttachRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorBackupAttachResponse>>
  sendAuthenticatorOptionsRuntimeMessage: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendAuthenticatorOptionsRuntimeMessage
    >[0],
  ) => Promise<RuntimeMessageDelivery<AuthenticatorOptionsResponse>>
  sendRuntimeMessageWithoutResponse: (
    message: Parameters<
      typeof import('./autofill/login-passkey-actions').sendRuntimeMessageWithoutResponse
    >[0],
  ) => void
  translatedMessage: (key: BrowserMessageKey) => string
  translatedMessageWithSubstitution: (args: {
    key: BrowserMessageKey
    substitution: string
  }) => string
  returnToActions: () => void
}

enum BackupAttachMode {
  Replace = 'replace',
  Merge = 'merge',
}

function detectEnrollmentHints(): EnrollmentPageHints {
  return {
    qr: pageHasQrEnrollmentHint(),
    backupCodes: pageHasBackupCodeHint(),
  }
}

function unavailableMessage(host: BackupEnrollmentHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetConnectVault)
}

function lockedBackupMessage(host: BackupEnrollmentHost): string {
  return host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetEnrollUnlock)
}

function mergeBackupCandidates({
  existing,
  incoming,
}: {
  existing: string[]
  incoming: string[]
}): string[] {
  const merged = [...existing]
  const seen = new Set(existing)
  for (const code of incoming) {
    if (seen.has(code)) continue
    seen.add(code)
    merged.push(code)
  }
  return merged
}

function showBackupModeChooser({
  host,
  section,
  account,
  codes,
}: {
  host: BackupEnrollmentHost
  section: HTMLElement
  account: WebsiteAuthenticatorOption
  codes: string[]
}): void {
  section.replaceChildren()
  const nookTypedArgs0_45: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupReview),
  }
  setHostDescription(nookTypedArgs0_45)

  const attach = (mode: BackupAttachMode) => {
    if (host.isBusy()) return
    host.setBusy(true)
    const nookTypedArgs0_46: Parameters<typeof setHostDescription>[0] = {
      host,
      text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
    }
    setHostDescription(nookTypedArgs0_46)
    const message: Parameters<
      typeof host.sendAuthenticatorBackupAttachRuntimeMessage
    >[0] = {
      type: WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach,
      payload: {
        origin: location.origin,
        vaultStoreId: account.vaultStoreId,
        secretId: account.secretId,
        codes: [...codes],
        mode,
      },
    }
    void host
      .sendAuthenticatorBackupAttachRuntimeMessage(message)
      .then((delivery) => {
        if (
          delivery.kind === RuntimeMessageDeliveryKind.Delivered &&
          delivery.response.kind ===
            AuthenticatorBackupAttachResponseKind.Completed
        ) {
          const nookTypedArgs0_47: Parameters<typeof setHostDescription>[0] = {
            host,
            text: host.translatedMessage(
              BROWSER_MESSAGE_KEYS.WidgetBackupSaved,
            ),
          }
          setHostDescription(nookTypedArgs0_47)
        } else if (
          delivery.kind === RuntimeMessageDeliveryKind.Delivered &&
          delivery.response.kind ===
            AuthenticatorBackupAttachResponseKind.Rejected &&
          'reason' in delivery.response &&
          delivery.response.reason === 'authenticator-locked'
        ) {
          const nookTypedArgs0_48: Parameters<typeof setHostDescription>[0] = {
            host,
            text: lockedBackupMessage(host),
          }
          setHostDescription(nookTypedArgs0_48)
        } else {
          const nookTypedArgs0_49: Parameters<typeof setHostDescription>[0] = {
            host,
            text: host.translatedMessage(
              BROWSER_MESSAGE_KEYS.WidgetBackupFailed,
            ),
          }
          setHostDescription(nookTypedArgs0_49)
        }
      })
      .finally(() => {
        clearBackupCodeCandidates(codes)
        host.setBusy(false)
        host.returnToActions()
      })
  }

  const nookTypedArgs0_51: Parameters<typeof createSecondaryButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupModeReplace,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      attach(BackupAttachMode.Replace)
    },
  }
  const replaceButton = createSecondaryButton(nookTypedArgs0_51)
  const nookTypedArgs0_52: Parameters<typeof createSecondaryButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupModeMerge,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted)) return
      attach(BackupAttachMode.Merge)
    },
  }
  const mergeButton = createSecondaryButton(nookTypedArgs0_52)
  const nookTypedArgs0_53: Parameters<typeof appendButtonRow>[0] = {
    container: section,
    buttons: [replaceButton, mergeButton],
  }
  appendButtonRow(nookTypedArgs0_53)

  const nookTypedArgs1_6: Parameters<typeof createTextButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      const nookTypedArgs0_54: Parameters<typeof resetEnrollmentHeadline>[0] = {
        host,
        hints: detectEnrollmentHints(),
      }
      resetEnrollmentHeadline(nookTypedArgs0_54)
      host.returnToActions()
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_6)
  section.append(cancelButton)
}

function showBackupAuthenticatorChooser({
  host,
  section,
  accounts,
  codes,
}: {
  host: BackupEnrollmentHost
  section: HTMLElement
  accounts: WebsiteAuthenticatorOption[]
  codes: string[]
}): void {
  section.replaceChildren()
  const nookTypedArgs0_56: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(
      BROWSER_MESSAGE_KEYS.WidgetBackupChooseAuthenticator,
    ),
  }
  setHostDescription(nookTypedArgs0_56)
  const list = document.createElement('div')
  list.className = 'account-list'
  ;[...accounts.entries()].forEach(([index, account]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'secondary-button account-button'
    const substitutionArgs: Parameters<
      typeof host.translatedMessageWithSubstitution
    >[0] = {
      key: BROWSER_MESSAGE_KEYS.WidgetSavedAuthenticator,
      substitution: safeSavedOptionNumber(index),
    }
    button.textContent =
      host.translatedMessageWithSubstitution(substitutionArgs)
    button.addEventListener('click', (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      const nookTypedArgs0_57: Parameters<typeof showBackupModeChooser>[0] = {
        host,
        section,
        account,
        codes,
      }
      showBackupModeChooser(nookTypedArgs0_57)
    })
    list.append(button)
  })
  section.append(list)

  const nookTypedArgs1_7: Parameters<typeof createTextButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      const nookTypedArgs0_58: Parameters<typeof resetEnrollmentHeadline>[0] = {
        host,
        hints: detectEnrollmentHints(),
      }
      resetEnrollmentHeadline(nookTypedArgs0_58)
      host.returnToActions()
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_7)
  section.append(cancelButton)
}

async function continueBackupWithAuthenticatorOptions({
  host,
  section,
  codes,
}: {
  host: BackupEnrollmentHost
  section: HTMLElement
  codes: string[]
}): Promise<void> {
  const nookTypedArgs0_60: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
  }
  setHostDescription(nookTypedArgs0_60)
  host.setBusy(true)

  try {
    const message: Parameters<
      typeof host.sendAuthenticatorOptionsRuntimeMessage
    >[0] = {
      type: WebsiteAuthenticatorOptionsMessageType.NookWebsiteAuthenticatorOptions,
      payload: { origin: location.origin },
    }
    const delivery = await host.sendAuthenticatorOptionsRuntimeMessage(message)

    if (delivery.kind === RuntimeMessageDeliveryKind.Unavailable) {
      const nookTypedArgs0_61: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
      }
      setHostDescription(nookTypedArgs0_61)
      host.returnToActions()
      clearBackupCodeCandidates(codes)
      return
    }
    const { response } = delivery

    if (response.kind === AuthenticatorOptionsResponseKind.Locked) {
      const nookTypedArgs0_63: Parameters<typeof setHostDescription>[0] = {
        host,
        text: lockedBackupMessage(host),
      }
      setHostDescription(nookTypedArgs0_63)
      host.returnToActions()
      clearBackupCodeCandidates(codes)
      return
    }

    if (response.kind === AuthenticatorOptionsResponseKind.Unavailable) {
      const nookTypedArgs0_65: Parameters<typeof setHostDescription>[0] = {
        host,
        text: unavailableMessage(host),
      }
      setHostDescription(nookTypedArgs0_65)
      host.returnToActions()
      clearBackupCodeCandidates(codes)
      return
    }

    if (
      response.kind !== AuthenticatorOptionsResponseKind.Ready ||
      !('accounts' in response)
    ) {
      const nookTypedArgs0_66: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
      }
      setHostDescription(nookTypedArgs0_66)
      host.returnToActions()
      clearBackupCodeCandidates(codes)
      return
    }

    const accounts: WebsiteAuthenticatorOption[] = response.accounts
    if (accounts.length === 0) {
      const nookTypedArgs0_67: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupFailed),
      }
      setHostDescription(nookTypedArgs0_67)
      host.returnToActions()
      clearBackupCodeCandidates(codes)
      return
    }

    if (accounts.length === 1) {
      const nookTypedArgs0_69: Parameters<typeof showBackupModeChooser>[0] = {
        host,
        section,
        account: accounts[0],
        codes,
      }
      showBackupModeChooser(nookTypedArgs0_69)
      return
    }

    const nookTypedArgs0_70: Parameters<
      typeof showBackupAuthenticatorChooser
    >[0] = { host, section, accounts, codes }
    showBackupAuthenticatorChooser(nookTypedArgs0_70)
  } finally {
    host.setBusy(false)
  }
}

function collectSelectedBackupCodes(list: HTMLElement): string[] {
  const selected: string[] = []
  for (const row of list.children) {
    if (!(row instanceof HTMLLabelElement)) continue
    const checkbox = row.querySelector('input[type="checkbox"]')
    const text = row.querySelector('span')
    if (
      checkbox instanceof HTMLInputElement &&
      checkbox.checked &&
      text instanceof HTMLSpanElement &&
      text.textContent
    ) {
      selected.push(text.textContent)
    }
  }
  return selected
}

function showBackupReview({
  host,
  section,
  codes,
}: {
  host: BackupEnrollmentHost
  section: HTMLElement
  codes: string[]
}): void {
  section.replaceChildren()
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
  )
  const nookTypedArgs0_71: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupReview),
  }
  setHostDescription(nookTypedArgs0_71)

  const list = document.createElement('div')
  list.className = 'account-list'

  const renderCodeRows = (): void => {
    list.replaceChildren()
    codes.forEach((code) => {
      const row = document.createElement('label')
      row.className = 'description'
      row.style.display = 'grid'
      row.style.gridTemplateColumns = 'auto 1fr auto'
      row.style.gap = '8px'
      row.style.textAlign = 'left'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = true

      const text = document.createElement('span')
      text.textContent = code

      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = 'text-button'
      removeButton.textContent = '×'
      removeButton.setAttribute(
        'aria-label',
        host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupCancel),
      )
      removeButton.addEventListener('click', (event) => {
        if (!isTrustedAuthAction(event.isTrusted)) return
        const index = codes.indexOf(code)
        if (index >= 0) codes.splice(index, 1)
        renderCodeRows()
      })

      row.append(checkbox, text, removeButton)
      list.append(row)
    })
  }

  renderCodeRows()

  const pasteLabel = document.createElement('p')
  pasteLabel.className = 'description'
  pasteLabel.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupPaste,
  )

  const pasteArea = document.createElement('textarea')
  pasteArea.className = 'description'
  pasteArea.rows = 4
  pasteArea.setAttribute(
    'aria-label',
    host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupPaste),
  )
  pasteArea.addEventListener('input', () => {
    const pasted = extractBackupCodeCandidates(pasteArea.value)
    if (pasted.length === 0) return
    const nookTypedArgs0_72: Parameters<typeof mergeBackupCandidates>[0] = {
      existing: codes,
      incoming: pasted,
    }
    const merged = mergeBackupCandidates(nookTypedArgs0_72)
    codes.length = 0
    merged.forEach((code) => codes.push(code))
    pasteArea.value = ''
    renderCodeRows()
  })

  section.append(list, pasteLabel, pasteArea)

  const nookTypedArgs1_8: Parameters<typeof createPrimaryButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupConfirm,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      const selected = collectSelectedBackupCodes(list)
      if (selected.length === 0) {
        const nookTypedArgs0_73: Parameters<typeof setHostDescription>[0] = {
          host,
          text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupEmpty),
        }
        setHostDescription(nookTypedArgs0_73)
        return
      }
      const nookTypedArgs0_74: Parameters<
        typeof continueBackupWithAuthenticatorOptions
      >[0] = {
        host,
        section,
        codes: selected,
      }
      void continueBackupWithAuthenticatorOptions(nookTypedArgs0_74)
    },
  }
  const confirmButton = createPrimaryButton(nookTypedArgs1_8)

  const nookTypedArgs1_9: Parameters<typeof createTextButton>[0] = {
    host,
    labelKey: BROWSER_MESSAGE_KEYS.WidgetBackupCancel,
    onClick: (event) => {
      if (!isTrustedAuthAction(event.isTrusted) || host.isBusy()) return
      clearBackupCodeCandidates(codes)
      const nookTypedArgs0_75: Parameters<typeof resetEnrollmentHeadline>[0] = {
        host,
        hints: detectEnrollmentHints(),
      }
      resetEnrollmentHeadline(nookTypedArgs0_75)
      host.returnToActions()
    },
  }
  const cancelButton = createTextButton(nookTypedArgs1_9)

  const nookTypedArgs0_77: Parameters<typeof appendButtonRow>[0] = {
    container: section,
    buttons: [confirmButton, cancelButton],
  }
  appendButtonRow(nookTypedArgs0_77)
}

export async function startBackupEnrollment({
  host,
  section,
}: {
  host: BackupEnrollmentHost
  section: HTMLElement
}): Promise<void> {
  host.title.textContent = host.translatedMessage(
    BROWSER_MESSAGE_KEYS.WidgetBackupTitle,
  )
  const nookTypedArgs0_78: Parameters<typeof setHostDescription>[0] = {
    host,
    text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupWorking),
  }
  setHostDescription(nookTypedArgs0_78)
  host.setBusy(true)
  section.replaceChildren()

  try {
    const codes = extractBackupCodeCandidates()
    if (codes.length === 0) {
      const nookTypedArgs0_79: Parameters<typeof setHostDescription>[0] = {
        host,
        text: host.translatedMessage(BROWSER_MESSAGE_KEYS.WidgetBackupEmpty),
      }
      setHostDescription(nookTypedArgs0_79)
      host.returnToActions()
      return
    }
    const nookTypedArgs0_81: Parameters<typeof showBackupReview>[0] = {
      host,
      section,
      codes,
    }
    showBackupReview(nookTypedArgs0_81)
  } finally {
    host.setBusy(false)
  }
}
