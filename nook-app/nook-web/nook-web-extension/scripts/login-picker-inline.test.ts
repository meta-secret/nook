import { describe, expect, test } from 'bun:test'
import { LoginPickerFrameBindingKind } from '../src/lib/inline-login-picker'
import {
  LoginPickerFrameAdmission,
  LoginPickerFrameTarget,
} from '../src/background/service-worker/login-picker-frame-target'
import type { PendingLoginPicker } from '../src/background/service-worker/account-picker-session-codec'

class InlinePickerFixture {
  readonly tab: chrome.tabs.Tab = {
    id: 42,
    index: 0,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    lastAccessed: 0,
    groupId: -1,
  }
  readonly request: PendingLoginPicker = {
    requestId: 'private-request',
    origin: 'https://login.example.test',
    tabId: 42,
    frameId: 7,
    parentDocumentId: 'parent-document',
    expiresAt: Date.now() + 60_000,
    allowedVaultStoreIds: ['vault-1'],
    pickerDocument: { kind: LoginPickerFrameBindingKind.AwaitingDocument },
  }
  readonly sender: chrome.runtime.MessageSender = {
    id: 'nook-extension',
    tab: this.tab,
    frameId: 8,
    documentId: 'picker-document',
    origin: new URL('chrome-extension://nook-extension/').origin,
    url: 'chrome-extension://nook-extension/login-picker/index.html',
  }

  constructor() {
    const browser = {
      chrome: {
        runtime: {
          id: 'nook-extension',
          getURL: (path: string) =>
            `chrome-extension://nook-extension/${path.replace(/^\//, '')}`,
        },
      },
    }
    Object.assign(globalThis, browser)
  }

  target(sender: chrome.runtime.MessageSender): LoginPickerFrameTarget {
    const request: ConstructorParameters<typeof LoginPickerFrameTarget>[0] = {
      request: this.request,
      sender,
    }
    return new LoginPickerFrameTarget(request)
  }

  bind(): LoginPickerFrameAdmission {
    const query: Parameters<LoginPickerFrameTarget['queryAdmission']>[0] = {
      request: this.request,
      sender: this.sender,
      parentOrigin: this.request.origin,
    }
    return this.target(this.sender).queryAdmission(query)
  }
}

describe('inline login request document binding', () => {
  test('cannot select or cancel from an unbound document; first query pins before metadata work', () => {
    const fixture = new InlinePickerFixture()
    expect(fixture.target(fixture.sender).boundAdmission()).toBe(
      LoginPickerFrameAdmission.Forbidden,
    )
    expect(fixture.bind()).toBe(LoginPickerFrameAdmission.Accepted)
    expect(fixture.request.pickerDocument).toEqual({
      kind: LoginPickerFrameBindingKind.Bound,
      frameId: 8,
      documentId: 'picker-document',
    })
    expect(fixture.target(fixture.sender).boundAdmission()).toBe(
      LoginPickerFrameAdmission.Accepted,
    )
  })

  test('rejects a mismatched requesting origin without claiming the request', () => {
    const fixture = new InlinePickerFixture()
    const query: Parameters<LoginPickerFrameTarget['queryAdmission']>[0] = {
      request: fixture.request,
      sender: fixture.sender,
      parentOrigin: 'https://hostile.example.test',
    }
    expect(fixture.target(fixture.sender).queryAdmission(query)).toBe(
      LoginPickerFrameAdmission.Forbidden,
    )
    expect(fixture.request.pickerDocument.kind).toBe(
      LoginPickerFrameBindingKind.AwaitingDocument,
    )
  })

  test('rejects another tab, frame, document, extension origin, page URL and host sender', () => {
    const fixture = new InlinePickerFixture()
    expect(fixture.bind()).toBe(LoginPickerFrameAdmission.Accepted)
    const candidates: chrome.runtime.MessageSender[] = [
      { ...fixture.sender, tab: { ...fixture.tab, id: 43 } },
      { ...fixture.sender, frameId: 9 },
      { ...fixture.sender, documentId: 'reloaded-document' },
      { ...fixture.sender, origin: fixture.request.origin },
      {
        ...fixture.sender,
        url: 'chrome-extension://nook-extension/popup/index.html',
      },
      { ...fixture.sender, id: 'hostile-extension' },
    ]
    for (const candidate of candidates) {
      expect(fixture.target(candidate).boundAdmission()).toBe(
        LoginPickerFrameAdmission.Forbidden,
      )
      const query: Parameters<LoginPickerFrameTarget['queryAdmission']>[0] = {
        request: fixture.request,
        sender: candidate,
        parentOrigin: fixture.request.origin,
      }
      expect(fixture.target(candidate).queryAdmission(query)).toBe(
        LoginPickerFrameAdmission.Forbidden,
      )
    }
  })
})
