import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WebsitePasskeyCeremony } from '../../../../nook-web-extension/src/lib/webauthn-message-types'
import {
  PasskeyPrompt,
  PasskeyPromptChoiceKind,
  PasskeyPromptPanel,
  type PasskeyPromptRequest,
} from '../../../../nook-web-extension/src/content/passkey-prompt'
import { WIDGET_HOST_ID } from '../../../../nook-web-extension/src/content/in-page-surface'

const createRequest: PasskeyPromptRequest = {
  ceremony: WebsitePasskeyCeremony.Create,
  site: 'google.com',
  siteName: 'Google',
  userName: 'alice@example.com',
  options: [
    { vaultStoreId: 'vault-personal', vaultName: 'Personal' },
    { vaultStoreId: 'vault-work', vaultName: 'Work' },
  ],
}

const getRequest: PasskeyPromptRequest = {
  ceremony: WebsitePasskeyCeremony.Get,
  site: 'github.com',
  siteName: 'github.com',
  options: [
    {
      vaultStoreId: 'vault-personal',
      vaultName: 'Personal',
      account: {
        credentialId: 'credential-alice',
        userName: 'alice@example.com',
        userDisplayName: 'Alice',
      },
    },
    {
      vaultStoreId: 'vault-work',
      vaultName: 'Work',
      account: {
        credentialId: 'credential-bob',
        userName: 'bob',
        userDisplayName: '',
      },
    },
  ],
}

type PanelFixture = {
  panel: PasskeyPromptPanel
  onClose: ReturnType<typeof vi.fn>
}

function openPanel(request: PasskeyPromptRequest): PanelFixture {
  const onClose = vi.fn()
  const panel = new PasskeyPromptPanel({ request, onClose })
  document.body.append(panel.element)
  return { panel, onClose }
}

function text(panel: PasskeyPromptPanel): string {
  return panel.element.textContent || ''
}

function button(panel: PasskeyPromptPanel, label: string): HTMLButtonElement {
  const match = Array.from(
    panel.element.querySelectorAll<HTMLButtonElement>('button'),
  ).find(
    (candidate) =>
      candidate.textContent?.includes(label) ||
      candidate.getAttribute('aria-label') === label,
  )
  if (!match) throw new Error(`No button labelled ${label}`)
  return match
}

beforeEach(() => {
  Object.assign(globalThis, {
    chrome: {
      i18n: {
        getMessage: (key: string, substitution?: string) =>
          substitution ? `${key}(${substitution})` : key,
      },
      runtime: { getURL: (path: string) => path },
    },
  })
})

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement
    .querySelectorAll('aside')
    .forEach((host) => host.remove())
  Reflect.deleteProperty(globalThis, 'chrome')
  vi.useRealTimers()
})

describe('passkey save card', () => {
  test('names the site, the account being saved, and where it goes', () => {
    const { panel } = openPanel(createRequest)

    expect(panel.element.querySelector('h1')?.textContent).toBe(
      'passkeySaveTitle(Google)',
    )
    expect(text(panel)).toContain('google.com')
    expect(text(panel)).toContain('alice@example.com')
    const radios = Array.from(
      panel.element.querySelectorAll<HTMLInputElement>('input[type=radio]'),
    )
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    expect(text(panel)).toContain('Personal')
    expect(text(panel)).toContain('Work')
  })

  test('saves to the vault the user picked', async () => {
    const { panel } = openPanel(createRequest)
    const work =
      panel.element.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]
    work?.click()

    button(panel, 'passkeySaveAction').click()

    await expect(panel.choice).resolves.toEqual({
      kind: PasskeyPromptChoiceKind.Selected,
      option: createRequest.options[1],
    })
  })

  test('shows progress, then a confirmation the user can close', () => {
    const { panel, onClose } = openPanel(createRequest)

    panel.showWorking()
    expect(text(panel)).toContain('passkeySaving')
    expect(panel.element.querySelectorAll('input')).toHaveLength(0)
    expect(button(panel, 'passkeyClose').hidden).toBe(true)
    panel.dismiss()
    expect(onClose).not.toHaveBeenCalled()

    panel.showSaved('Work')
    expect(panel.element.querySelector('h1')?.textContent).toBe(
      'passkeySavedTitle',
    )
    expect(text(panel)).toContain('passkeySavedDetail(Work)')
    button(panel, 'passkeyClose').click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('keeps a failed save visible until the user closes it', () => {
    const { panel, onClose } = openPanel(createRequest)

    panel.showWorking()
    panel.showFailed()

    expect(text(panel)).toContain('passkeySaveFailed')
    expect(button(panel, 'passkeyClose').hidden).toBe(false)
    panel.dismiss()
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('declines when closed and defers to the browser on request', async () => {
    const declined = openPanel(createRequest).panel
    button(declined, 'passkeyClose').click()
    await expect(declined.choice).resolves.toEqual({
      kind: PasskeyPromptChoiceKind.Dismissed,
    })

    const deferred = openPanel(createRequest).panel
    button(deferred, 'passkeyUseBrowser').click()
    await expect(deferred.choice).resolves.toEqual({
      kind: PasskeyPromptChoiceKind.BrowserFallback,
    })
  })
})

describe('passkey sign-in card', () => {
  test('lists each account with its vault and signs in with the chosen one', async () => {
    const { panel } = openPanel(getRequest)

    expect(panel.element.querySelector('h1')?.textContent).toBe(
      'passkeyUseTitle(github.com)',
    )
    const rows = Array.from(
      panel.element.querySelectorAll<HTMLButtonElement>('.account-option'),
    )
    expect(rows.map((row) => row.textContent)).toEqual([
      'AAlicealice@example.com · Personal',
      'bbobWork',
    ])

    rows[1]?.click()

    await expect(panel.choice).resolves.toEqual({
      kind: PasskeyPromptChoiceKind.Selected,
      option: getRequest.options[1],
    })
  })

  test('reports a failed sign-in', () => {
    const { panel } = openPanel(getRequest)

    panel.showWorking()
    expect(text(panel)).toContain('passkeySigningIn')
    panel.showFailed()
    expect(text(panel)).toContain('passkeyUseFailed')
  })
})

describe('passkey card on the page', () => {
  test('takes the Pilot corner while open and gives it back when closed', () => {
    const pilot = document.createElement('aside')
    pilot.id = WIDGET_HOST_ID
    document.body.append(pilot)

    const prompt = PasskeyPrompt.open(createRequest)
    const host = document.querySelector(
      'aside[aria-label="passkeyPromptLabel"]',
    )
    expect(host).toBeTruthy()
    expect(pilot.style.visibility).toBe('hidden')

    prompt.close()
    expect(host?.isConnected).toBe(false)
    expect(pilot.style.visibility).toBe('')
  })

  test('closes a saved confirmation on its own', () => {
    vi.useFakeTimers()
    const prompt = PasskeyPrompt.open(createRequest)
    const host = document.querySelector(
      'aside[aria-label="passkeyPromptLabel"]',
    )

    prompt.showWorking()
    prompt.showSaved('Personal')
    expect(host?.isConnected).toBe(true)
    vi.advanceTimersByTime(3_000)
    expect(host?.isConnected).toBe(false)
  })

  test('Escape declines a pending choice', async () => {
    const prompt = PasskeyPrompt.open(createRequest)
    const host = document.querySelector(
      'aside[aria-label="passkeyPromptLabel"]',
    )

    host?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    await expect(prompt.choice).resolves.toEqual({
      kind: PasskeyPromptChoiceKind.Dismissed,
    })
  })
})
