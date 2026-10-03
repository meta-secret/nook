import { LoginPickerFrameBindingKind } from '../../lib/inline-login-picker'
import type { PendingLoginPicker } from './account-picker-session-codec'

export enum LoginPickerFrameAdmission {
  Accepted = 'accepted',
  Forbidden = 'forbidden',
}

interface LoginPickerFrameRequest {
  readonly request: PendingLoginPicker
  readonly sender: chrome.runtime.MessageSender
}

interface LoginPickerFrameQuery extends LoginPickerFrameRequest {
  readonly parentOrigin: string
}

/** Owns browser identity admission for the document of one existing picker request. */
export class LoginPickerFrameTarget {
  constructor(private readonly request: LoginPickerFrameRequest) {}

  private documentAdmission(): LoginPickerFrameAdmission {
    const { sender, request } = this.request
    switch (
      sender.id === chrome.runtime.id &&
      sender.tab?.id === request.tabId &&
      typeof sender.documentId === 'string' &&
      sender.documentId.length > 0 &&
      typeof sender.frameId === 'number' &&
      Number.isInteger(sender.frameId) &&
      sender.frameId > 0 &&
      sender.url === chrome.runtime.getURL('login-picker/index.html') &&
      sender.origin === new URL(chrome.runtime.getURL('/')).origin
    ) {
      case true:
        return LoginPickerFrameAdmission.Accepted
      case false:
        return LoginPickerFrameAdmission.Forbidden
    }
  }

  queryAdmission(query: LoginPickerFrameQuery): LoginPickerFrameAdmission {
    switch (query.parentOrigin === this.request.request.origin) {
      case false:
        return LoginPickerFrameAdmission.Forbidden
      case true:
        break
    }
    switch (this.documentAdmission()) {
      case LoginPickerFrameAdmission.Forbidden:
        return LoginPickerFrameAdmission.Forbidden
      case LoginPickerFrameAdmission.Accepted:
        break
    }
    const { request } = this.request
    switch (request.pickerDocument.kind) {
      case LoginPickerFrameBindingKind.AwaitingDocument:
        // Pin synchronously before the first metadata lookup or storage await.
        return this.bindDocument()
      case LoginPickerFrameBindingKind.Bound:
        return this.boundAdmission()
    }
  }

  private bindDocument(): LoginPickerFrameAdmission {
    const { request, sender } = this.request
    switch (typeof sender.documentId) {
      case 'string':
        break
      case 'number':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
      case 'object':
      case 'function':
        return LoginPickerFrameAdmission.Forbidden
    }
    switch (typeof sender.frameId) {
      case 'number':
        request.pickerDocument = {
          kind: LoginPickerFrameBindingKind.Bound,
          frameId: sender.frameId,
          documentId: sender.documentId,
        }
        return LoginPickerFrameAdmission.Accepted
      case 'string':
      case 'bigint':
      case 'boolean':
      case 'symbol':
      case 'undefined':
      case 'object':
      case 'function':
        return LoginPickerFrameAdmission.Forbidden
    }
  }

  boundAdmission(): LoginPickerFrameAdmission {
    switch (this.documentAdmission()) {
      case LoginPickerFrameAdmission.Forbidden:
        return LoginPickerFrameAdmission.Forbidden
      case LoginPickerFrameAdmission.Accepted:
        break
    }
    const { request, sender } = this.request
    switch (request.pickerDocument.kind) {
      case LoginPickerFrameBindingKind.AwaitingDocument:
        return LoginPickerFrameAdmission.Forbidden
      case LoginPickerFrameBindingKind.Bound:
        switch (
          sender.frameId === request.pickerDocument.frameId &&
          sender.documentId === request.pickerDocument.documentId
        ) {
          case true:
            return LoginPickerFrameAdmission.Accepted
          case false:
            return LoginPickerFrameAdmission.Forbidden
        }
    }
  }
}
