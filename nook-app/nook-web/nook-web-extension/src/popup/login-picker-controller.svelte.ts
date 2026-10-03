import { Effect, Schema } from 'effect'
import { I18N_KEYS, type I18nKey } from '../../../nook-web-shared/src/generated/i18n-keys'
import type { WebsiteLoginAccountOption } from '../lib/login-fill-messages'
import {
  LoginPickerCancelMessageType,
  LoginPickerQueryMessageType,
  LoginPickerQueryResponse,
  LoginPickerSelectMessageType,
  LoginPickerSelectResponse,
  type LoginPickerCancelMessage,
  type LoginPickerQueryMessage,
  type LoginPickerSelectMessage,
} from '../lib/login-picker-messages'
import { ExtensionTranslationRequestKind, extensionLocaleCatalog, type ExtensionI18n, type ExtensionTranslationRequest } from '../lib/i18n'

export enum LoginPickerActivity {
  Loading = 'loading',
  Ready = 'ready',
  Selecting = 'selecting',
  Failed = 'failed',
  Complete = 'complete',
}

export enum LoginPickerLifetime {
  Active = 'active',
  Completed = 'completed',
}

interface LoginPickerDocumentRequest {
  readonly requestId: string
  readonly parentOrigin: string
  readonly i18n: ExtensionI18n
}

class LoginPickerTransportFailure extends Schema.TaggedError<LoginPickerTransportFailure>()(
  'LoginPickerTransportFailure',
  {},
) {}

interface LoginPickerRuntimeCall {
  readonly try: () => Promise<unknown>
  readonly catch: () => LoginPickerTransportFailure
}

interface LoginPickerCancellationCall {
  readonly try: () => Promise<void>
  readonly catch: () => LoginPickerTransportFailure
}

/** Owns the immediate extension-document metadata and its interaction lifetime. */
export class LoginPickerController {
  query = $state('')
  accounts = $state<WebsiteLoginAccountOption[]>([])
  destinationOrigin = $state('')
  activity = $state(LoginPickerActivity.Loading)
  private sequence = 0
  private lifetime = LoginPickerLifetime.Active

  constructor(private readonly request: LoginPickerDocumentRequest) {}

  translate(key: I18nKey): string {
    return this.request.i18n.t(extensionLocaleCatalog.plainExtensionTranslation(key))
  }

  primaryLabel(account: WebsiteLoginAccountOption): string {
    switch (account.username.trim().length > 0) {
      case true:
        return account.username.trim()
      case false:
        break
    }
    switch (account.websiteHost.trim().length > 0) {
      case true:
        return account.websiteHost.trim()
      case false:
        return this.translate(I18N_KEYS.ExtensionLoginPickerUnnamed)
    }
  }

  destinationLabel(origin: string): string {
    const request: ExtensionTranslationRequest = {
      kind: ExtensionTranslationRequestKind.WithReplacements,
      key: I18N_KEYS.ExtensionLoginPickerDestination,
      replacements: { origin },
    }
    return this.request.i18n.t(request)
  }

  private sendQuery(message: LoginPickerQueryMessage) {
    const transport: LoginPickerRuntimeCall = {
      try: () => chrome.runtime.sendMessage(message),
      catch: () => new LoginPickerTransportFailure(),
    }
    return Effect.tryPromise(transport).pipe(Effect.flatMap(LoginPickerQueryResponse.decode))
  }

  private sendSelection(message: LoginPickerSelectMessage) {
    const transport: LoginPickerRuntimeCall = {
      try: () => chrome.runtime.sendMessage(message),
      catch: () => new LoginPickerTransportFailure(),
    }
    return Effect.tryPromise(transport).pipe(Effect.flatMap(LoginPickerSelectResponse.decode))
  }

  load(searchQuery: string): void {
    switch (this.lifetime) {
      case LoginPickerLifetime.Completed:
        return
      case LoginPickerLifetime.Active:
        break
    }
    const sequence = ++this.sequence
    this.activity = LoginPickerActivity.Loading
    const message: LoginPickerQueryMessage = {
      type: LoginPickerQueryMessageType.NookLoginPickerQuery,
      payload: { requestId: this.request.requestId, query: searchQuery, parentOrigin: this.request.parentOrigin },
    }
    const load = this.sendQuery(message).pipe(
      Effect.match({
        onFailure: () => this.loadedFailure(sequence),
        onSuccess: (response) => this.loaded({ sequence, response }),
      }),
    )
    void Effect.runPromise(load)
  }

  private loadedFailure(sequence: number): void {
    switch (sequence === this.sequence && this.lifetime === LoginPickerLifetime.Active) {
      case true:
        this.accounts = []
        this.destinationOrigin = ''
        this.activity = LoginPickerActivity.Failed
        break
      case false:
        break
    }
  }

  private loaded(result: LoginPickerLoaded): void {
    switch (result.sequence === this.sequence && this.lifetime === LoginPickerLifetime.Active) {
      case false:
        return
      case true:
        this.accounts = result.response.accounts
        this.destinationOrigin = result.response.origin
        this.activity = LoginPickerActivity.Ready
    }
  }

  choose(account: WebsiteLoginAccountOption): void {
    switch (this.activity) {
      case LoginPickerActivity.Loading:
      case LoginPickerActivity.Selecting:
      case LoginPickerActivity.Complete:
      case LoginPickerActivity.Failed:
        return
      case LoginPickerActivity.Ready:
        break
    }
    this.activity = LoginPickerActivity.Selecting
    const message: LoginPickerSelectMessage = {
      type: LoginPickerSelectMessageType.NookLoginPickerSelect,
      payload: { requestId: this.request.requestId, vaultStoreId: account.vaultStoreId, secretId: account.secretId },
    }
    const selection = this.sendSelection(message).pipe(Effect.match({
      onFailure: () => this.loadedFailure(this.sequence),
      onSuccess: () => this.complete(),
    }))
    void Effect.runPromise(selection)
  }

  private complete(): void {
    this.lifetime = LoginPickerLifetime.Completed
    this.sequence += 1
    this.accounts = []
    this.destinationOrigin = ''
    this.query = ''
    this.activity = LoginPickerActivity.Complete
  }

  close(): void {
    switch (this.lifetime) {
      case LoginPickerLifetime.Completed:
        return
      case LoginPickerLifetime.Active:
        this.complete()
    }
    const message: LoginPickerCancelMessage = {
      type: LoginPickerCancelMessageType.NookLoginPickerCancel,
      payload: { requestId: this.request.requestId },
    }
    const transport: LoginPickerCancellationCall = {
      try: async () => { await chrome.runtime.sendMessage(message) },
      catch: () => new LoginPickerTransportFailure(),
    }
    void Effect.runPromise(Effect.tryPromise(transport))
  }
}

interface LoginPickerLoaded {
  readonly sequence: number
  readonly response: LoginPickerQueryResponse
}
