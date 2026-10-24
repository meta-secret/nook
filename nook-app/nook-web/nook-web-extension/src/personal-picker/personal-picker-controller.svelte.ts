import { Effect, Schema } from 'effect'
import type { BrowserRuntimeMessageValue } from '../lib/browser-runtime-message'
import {
  I18N_KEYS,
  type I18nKey,
} from '../../../nook-web-shared/src/generated/i18n-keys'
import {
  PersonalFillMessageType,
  PersonalFillMessages,
  PersonalFillQueryResponseKind,
  PersonalFillSelectResponseKind,
  type PersonalFillCancelMessage,
  type PersonalFillQueryMessage,
  type PersonalFillQueryResponse,
  type PersonalFillRecordOption,
  type PersonalFillRecordOptions,
  type PersonalFillSelectMessage,
  type PersonalFillSelectResponse,
} from '../lib/personal-fill-messages'
import { extensionLocaleCatalog, type ExtensionI18n } from '../lib/i18n'

export enum PersonalPickerActivity {
  Loading = 'loading',
  Ready = 'ready',
  Selecting = 'selecting',
  Failed = 'failed',
  Complete = 'complete',
}

enum PersonalPickerLifetime {
  Active = 'active',
  Completed = 'completed',
}

enum PersonalPickerTitlePresence {
  Titled = 'titled',
  Untitled = 'untitled',
}

export interface PersonalPickerDocumentRequest {
  readonly requestId: string
  readonly parentOrigin: string
  readonly i18n: ExtensionI18n
}

const transportFailureFields: Readonly<Record<never, never>> = {}

class PersonalPickerTransportFailure extends Schema.TaggedError<PersonalPickerTransportFailure>()(
  'PersonalPickerTransportFailure',
  transportFailureFields,
) {}

interface PersonalPickerRuntimeCall {
  readonly try: () => Promise<BrowserRuntimeMessageValue>
  readonly catch: () => PersonalPickerTransportFailure
}

interface PersonalPickerCancellationCall {
  readonly try: () => Promise<void>
  readonly catch: () => PersonalPickerTransportFailure
}

interface PersonalPickerQueryMatcher {
  readonly onFailure: () => void
  readonly onSuccess: (response: PersonalFillQueryResponse) => void
}

interface PersonalPickerSelectionMatcher {
  readonly onFailure: () => void
  readonly onSuccess: (response: PersonalFillSelectResponse) => void
}

/**
 * Owns the extension-document list of one personal picker request. Titles and
 * summaries live only here; a choice sends the opaque record identity to the
 * worker, which notifies the requesting page.
 */
export class PersonalPickerController {
  records = $state<PersonalFillRecordOptions>([])
  activity = $state(PersonalPickerActivity.Loading)
  private lifetime = PersonalPickerLifetime.Active

  constructor(private readonly request: PersonalPickerDocumentRequest) {}

  translate(key: I18nKey): string {
    return this.request.i18n.t(
      extensionLocaleCatalog.plainExtensionTranslation(key),
    )
  }

  private titlePresence(
    record: PersonalFillRecordOption,
  ): PersonalPickerTitlePresence {
    switch (record.title.trim().length > 0) {
      case true:
        return PersonalPickerTitlePresence.Titled
      case false:
        return PersonalPickerTitlePresence.Untitled
    }
  }

  primaryLabel(record: PersonalFillRecordOption): string {
    switch (this.titlePresence(record)) {
      case PersonalPickerTitlePresence.Titled:
        return record.title.trim()
      case PersonalPickerTitlePresence.Untitled:
        return this.translate(I18N_KEYS.ExtensionPersonalPickerUnnamed)
    }
  }

  private send(message: PersonalFillQueryMessage | PersonalFillSelectMessage) {
    const transport: PersonalPickerRuntimeCall = {
      try: () => chrome.runtime.sendMessage(message),
      catch: () => new PersonalPickerTransportFailure(),
    }
    return Effect.tryPromise(transport)
  }

  load(): void {
    switch (this.lifetime) {
      case PersonalPickerLifetime.Completed:
        return
      case PersonalPickerLifetime.Active:
        break
    }
    this.activity = PersonalPickerActivity.Loading
    const message: PersonalFillQueryMessage = {
      type: PersonalFillMessageType.Query,
      payload: {
        requestId: this.request.requestId,
        parentOrigin: this.request.parentOrigin,
      },
    }
    const match: PersonalPickerQueryMatcher = {
      onFailure: () => this.failed(),
      onSuccess: (response) => this.loaded(response),
    }
    const load = this.send(message).pipe(
      Effect.flatMap(PersonalFillMessages.decodeQueryResponse),
      Effect.match(match),
    )
    void Effect.runPromise(load)
  }

  private failed(): void {
    switch (this.lifetime) {
      case PersonalPickerLifetime.Completed:
        return
      case PersonalPickerLifetime.Active:
        this.records = []
        this.activity = PersonalPickerActivity.Failed
    }
  }

  private loaded(response: PersonalFillQueryResponse): void {
    switch (this.lifetime) {
      case PersonalPickerLifetime.Completed:
        return
      case PersonalPickerLifetime.Active:
        break
    }
    switch (response.kind) {
      case PersonalFillQueryResponseKind.Failed:
        return this.failed()
      case PersonalFillQueryResponseKind.Ready:
        this.records = response.records
        this.activity = PersonalPickerActivity.Ready
    }
  }

  private selected(response: PersonalFillSelectResponse): void {
    switch (response.kind) {
      case PersonalFillSelectResponseKind.Failed:
        return this.failed()
      case PersonalFillSelectResponseKind.Selected:
        return this.complete()
    }
  }

  choose(record: PersonalFillRecordOption): void {
    switch (this.activity) {
      case PersonalPickerActivity.Loading:
      case PersonalPickerActivity.Selecting:
      case PersonalPickerActivity.Complete:
      case PersonalPickerActivity.Failed:
        return
      case PersonalPickerActivity.Ready:
        break
    }
    this.activity = PersonalPickerActivity.Selecting
    const message: PersonalFillSelectMessage = {
      type: PersonalFillMessageType.Select,
      payload: {
        requestId: this.request.requestId,
        vaultStoreId: record.vaultStoreId,
        secretId: record.secretId,
      },
    }
    const match: PersonalPickerSelectionMatcher = {
      onFailure: () => this.failed(),
      onSuccess: (response) => this.selected(response),
    }
    const selection = this.send(message).pipe(
      Effect.flatMap(PersonalFillMessages.decodeSelectResponse),
      Effect.match(match),
    )
    void Effect.runPromise(selection)
  }

  private complete(): void {
    this.lifetime = PersonalPickerLifetime.Completed
    this.records = []
    this.activity = PersonalPickerActivity.Complete
  }

  close(): void {
    switch (this.lifetime) {
      case PersonalPickerLifetime.Completed:
        return
      case PersonalPickerLifetime.Active:
        this.complete()
    }
    const message: PersonalFillCancelMessage = {
      type: PersonalFillMessageType.Cancel,
      payload: { requestId: this.request.requestId },
    }
    const transport: PersonalPickerCancellationCall = {
      try: async () => {
        await chrome.runtime.sendMessage(message)
      },
      catch: () => new PersonalPickerTransportFailure(),
    }
    void Effect.runPromise(Effect.ignore(Effect.tryPromise(transport)))
  }
}
