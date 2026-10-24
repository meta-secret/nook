import type { StoredExtensionPairingGrant } from '../pairing-grants'
import { AccountPickerPageTarget } from './account-picker-page-target'
import {
  PersonalFillCancelResponseKind,
  PersonalFillMessageType,
  PersonalFillOpenResponseKind,
  PersonalFillPageResponseKind,
  PersonalFillQueryResponseKind,
  PersonalFillRevealResponseKind,
  PersonalFillSelectResponseKind,
  type PersonalFillCancelMessage,
  type PersonalFillCancelResponse,
  type PersonalFillOpenMessage,
  type PersonalFillOpenResponse,
  type PersonalFillPageMessage,
  type PersonalFillPageResponse,
  type PersonalFillQueryMessage,
  type PersonalFillQueryResponse,
  type PersonalFillRecordOption,
  type PersonalFillRevealMessage,
  type PersonalFillRevealResponse,
  type PersonalFillSelectMessage,
  type PersonalFillSelectResponse,
} from '../../lib/personal-fill-messages'

export enum PersonalFillGrantAccessKind {
  Granted = 'granted',
  Locked = 'locked',
  Unavailable = 'unavailable',
  Forbidden = 'forbidden',
}

/** The sender-checked password-filling grants of an unlocked session. */
export type PersonalFillGrantAccess =
  | {
      readonly kind: PersonalFillGrantAccessKind.Granted
      readonly grants: readonly StoredExtensionPairingGrant[]
    }
  | { readonly kind: PersonalFillGrantAccessKind.Locked }
  | { readonly kind: PersonalFillGrantAccessKind.Unavailable }
  | { readonly kind: PersonalFillGrantAccessKind.Forbidden }

export type PersonalFillGrantAccessRequest = {
  readonly origin: string
  readonly sender: chrome.runtime.MessageSender
}

export enum PersonalFillRecordListingKind {
  Listed = 'listed',
  Failed = 'failed',
}

export type PersonalFillGrantRecords = readonly PersonalFillGrantRecord[]

/** Rust's list metadata for one record of one grant's vault. */
export type PersonalFillGrantRecord = {
  readonly secretId: string
  readonly title: string
  readonly summary: string
}

export type PersonalFillRecordListing =
  | {
      readonly kind: PersonalFillRecordListingKind.Listed
      readonly records: PersonalFillGrantRecords
    }
  | { readonly kind: PersonalFillRecordListingKind.Failed }

export type PersonalFillRecordListingRequest = {
  readonly grant: StoredExtensionPairingGrant
  readonly group: string
}

export type PersonalFillValueRevealRequest = {
  readonly grant: StoredExtensionPairingGrant
  readonly secretId: string
  readonly group: string
  readonly kinds: readonly string[]
}

export type PersonalFillPageDelivery = {
  readonly tabId: number
  readonly frameId: number
  readonly documentId: string
  readonly message: PersonalFillPageMessage
}

export type PersonalFillPickerDependencies = {
  readonly authorizationGeneration: () => Promise<string>
  readonly generationIsCurrent: (generation: string) => boolean
  readonly grantAccess: (
    request: PersonalFillGrantAccessRequest,
  ) => Promise<PersonalFillGrantAccess>
  readonly passwordGrants: () => Promise<readonly StoredExtensionPairingGrant[]>
  readonly isWebsiteSender: (request: PersonalFillGrantAccessRequest) => boolean
  readonly listRecords: (
    request: PersonalFillRecordListingRequest,
  ) => Promise<PersonalFillRecordListing>
  readonly revealValues: (
    request: PersonalFillValueRevealRequest,
  ) => Promise<PersonalFillRevealResponse>
  readonly sendToPage: (
    delivery: PersonalFillPageDelivery,
  ) => Promise<PersonalFillPageResponse>
  readonly randomNonce: () => string
  readonly now: () => number
  readonly runtimeId: string
  readonly pickerUrl: string
  readonly extensionOrigin: string
}

export type PersonalFillOperationRequest<Message> = {
  readonly message: Message
  readonly sender: chrome.runtime.MessageSender
}

enum PersonalPickerDocumentKind {
  AwaitingDocument = 'awaiting-document',
  Bound = 'bound',
}
type PersonalPickerDocument =
  | { readonly kind: PersonalPickerDocumentKind.AwaitingDocument }
  | {
      readonly kind: PersonalPickerDocumentKind.Bound
      readonly frameId: number
      readonly documentId: string
    }
enum PersonalPickerSelectionKind {
  Pending = 'pending',
  Selected = 'selected',
}
type PersonalPickerSelection =
  | { readonly kind: PersonalPickerSelectionKind.Pending }
  | {
      readonly kind: PersonalPickerSelectionKind.Selected
      readonly vaultStoreId: string
      readonly secretId: string
    }
type PendingPersonalPicker = {
  readonly requestId: string
  readonly origin: string
  readonly group: string
  readonly tabId: number
  readonly frameId: number
  readonly parentDocumentId: string
  readonly allowedVaultStoreIds: readonly string[]
  readonly expiresAt: number
  readonly authorizationGeneration: string
  document: PersonalPickerDocument
  selection: PersonalPickerSelection
}
enum PersonalPickerLoadKind {
  Loaded = 'loaded',
  Unavailable = 'unavailable',
}
type PersonalPickerLoad =
  | {
      readonly kind: PersonalPickerLoadKind.Loaded
      readonly picker: PendingPersonalPicker
    }
  | { readonly kind: PersonalPickerLoadKind.Unavailable }
enum PersonalPickerAdmission {
  Admitted = 'admitted',
  Forbidden = 'forbidden',
}
type PersonalPickerSenderCheck = {
  readonly picker: PendingPersonalPicker
  readonly sender: chrome.runtime.MessageSender
}
type PersonalPickerGrantListing = {
  readonly picker: PendingPersonalPicker
  readonly grants: readonly StoredExtensionPairingGrant[]
}
type PersonalPickerReveal = {
  readonly picker: PendingPersonalPicker
  readonly request: PersonalFillValueRevealRequest
}
enum PersonalPickerRecordPresence {
  Present = 'present',
  Absent = 'absent',
}

/**
 * Owns the in-memory personal picker requests, each bound to the requesting
 * tab, frame and document, its picker document, and the authorization
 * generation. Nothing is persisted: a worker restart, expiry or lock leaves
 * every request unusable, and the person starts again from the page.
 */
export class PersonalFillPickers {
  static readonly TTL_MS = 5 * 60 * 1000

  private readonly pickers = new Map<string, PendingPersonalPicker>()

  constructor(private readonly dependencies: PersonalFillPickerDependencies) {}

  private load(requestId: string): PersonalPickerLoad {
    const pending = Array.from(this.pickers.values()).filter(
      (picker) => picker.requestId === requestId,
    )
    for (const picker of pending) {
      return this.unexpired(picker)
    }
    return { kind: PersonalPickerLoadKind.Unavailable }
  }

  private unexpired(picker: PendingPersonalPicker): PersonalPickerLoad {
    switch (picker.expiresAt > this.dependencies.now()) {
      case true:
        return { kind: PersonalPickerLoadKind.Loaded, picker }
      case false:
        this.pickers.delete(picker.requestId)
        return { kind: PersonalPickerLoadKind.Unavailable }
    }
  }

  /** The sender is this extension's picker page, framed in the requesting tab. */
  private pickerDocumentAdmission(
    check: PersonalPickerSenderCheck,
  ): PersonalPickerAdmission {
    const { sender, picker } = check
    switch (
      sender.id === this.dependencies.runtimeId &&
      sender.tab?.id === picker.tabId &&
      typeof sender.documentId === 'string' &&
      sender.documentId.length > 0 &&
      typeof sender.frameId === 'number' &&
      Number.isInteger(sender.frameId) &&
      sender.frameId > 0 &&
      sender.url === this.dependencies.pickerUrl &&
      sender.origin === this.dependencies.extensionOrigin
    ) {
      case true:
        return PersonalPickerAdmission.Admitted
      case false:
        return PersonalPickerAdmission.Forbidden
    }
  }

  /** The first query pins the picker document; later requests must come from it. */
  private boundDocumentAdmission(
    check: PersonalPickerSenderCheck,
  ): PersonalPickerAdmission {
    switch (this.pickerDocumentAdmission(check)) {
      case PersonalPickerAdmission.Forbidden:
        return PersonalPickerAdmission.Forbidden
      case PersonalPickerAdmission.Admitted:
        break
    }
    const { picker, sender } = check
    switch (picker.document.kind) {
      case PersonalPickerDocumentKind.AwaitingDocument:
        picker.document = {
          kind: PersonalPickerDocumentKind.Bound,
          frameId: Number(sender.frameId),
          documentId: String(sender.documentId),
        }
        return PersonalPickerAdmission.Admitted
      case PersonalPickerDocumentKind.Bound:
        break
    }
    switch (
      sender.frameId === picker.document.frameId &&
      sender.documentId === picker.document.documentId
    ) {
      case true:
        return PersonalPickerAdmission.Admitted
      case false:
        return PersonalPickerAdmission.Forbidden
    }
  }

  /** The sender is the exact page document that opened the request. */
  private parentAdmission(
    check: PersonalPickerSenderCheck,
  ): PersonalPickerAdmission {
    const { sender, picker } = check
    const websiteRequest: PersonalFillGrantAccessRequest = {
      origin: picker.origin,
      sender,
    }
    switch (
      this.dependencies.isWebsiteSender(websiteRequest) &&
      sender.tab?.id === picker.tabId &&
      AccountPickerPageTarget.senderFrameId(sender) === picker.frameId &&
      sender.documentId === picker.parentDocumentId
    ) {
      case true:
        return PersonalPickerAdmission.Admitted
      case false:
        return PersonalPickerAdmission.Forbidden
    }
  }

  private async allowedGrants(
    picker: PendingPersonalPicker,
  ): Promise<readonly StoredExtensionPairingGrant[]> {
    const grants = await this.dependencies.passwordGrants()
    return grants.filter((grant) =>
      picker.allowedVaultStoreIds.includes(grant.vaultStoreId),
    )
  }

  /** Lists every allowed grant's records; any grant failure fails the whole listing. */
  private async records(
    listing: PersonalPickerGrantListing,
  ): Promise<PersonalFillQueryResponse> {
    const failed: PersonalFillQueryResponse = {
      kind: PersonalFillQueryResponseKind.Failed,
    }
    const records: PersonalFillRecordOption[] = []
    for (const grant of listing.grants) {
      const request: PersonalFillRecordListingRequest = {
        grant,
        group: listing.picker.group,
      }
      const listed = await this.dependencies.listRecords(request)
      switch (listed.kind) {
        case PersonalFillRecordListingKind.Failed:
          return failed
        case PersonalFillRecordListingKind.Listed:
          break
      }
      records.push(
        ...listed.records.map((record) => ({
          vaultStoreId: grant.vaultStoreId,
          secretId: record.secretId,
          title: record.title,
          summary: record.summary,
        })),
      )
    }
    return { kind: PersonalFillQueryResponseKind.Ready, records }
  }

  async open(
    request: PersonalFillOperationRequest<PersonalFillOpenMessage>,
  ): Promise<PersonalFillOpenResponse> {
    const { message, sender } = request
    const authorizationGeneration =
      await this.dependencies.authorizationGeneration()
    switch (this.dependencies.generationIsCurrent(authorizationGeneration)) {
      case false:
        return { kind: PersonalFillOpenResponseKind.Locked }
      case true:
        break
    }
    const accessRequest: PersonalFillGrantAccessRequest = {
      origin: message.payload.origin,
      sender,
    }
    const access = await this.dependencies.grantAccess(accessRequest)
    switch (access.kind) {
      case PersonalFillGrantAccessKind.Locked:
        return { kind: PersonalFillOpenResponseKind.Locked }
      case PersonalFillGrantAccessKind.Unavailable:
        return { kind: PersonalFillOpenResponseKind.Unavailable }
      case PersonalFillGrantAccessKind.Forbidden:
        return { kind: PersonalFillOpenResponseKind.Failed }
      case PersonalFillGrantAccessKind.Granted:
        break
    }
    const tabId = sender.tab?.id
    switch (
      typeof tabId === 'number' &&
      typeof sender.documentId === 'string'
    ) {
      case false:
        return { kind: PersonalFillOpenResponseKind.Failed }
      case true:
        break
    }
    const picker: PendingPersonalPicker = {
      requestId: this.dependencies.randomNonce(),
      origin: message.payload.origin,
      group: message.payload.group,
      tabId: Number(tabId),
      frameId: AccountPickerPageTarget.senderFrameId(sender),
      parentDocumentId: String(sender.documentId),
      allowedVaultStoreIds: access.grants.map((grant) => grant.vaultStoreId),
      expiresAt: this.dependencies.now() + PersonalFillPickers.TTL_MS,
      authorizationGeneration,
      document: { kind: PersonalPickerDocumentKind.AwaitingDocument },
      selection: { kind: PersonalPickerSelectionKind.Pending },
    }
    this.pickers.set(picker.requestId, picker)
    return {
      kind: PersonalFillOpenResponseKind.Ready,
      requestId: picker.requestId,
      expiresAt: picker.expiresAt,
    }
  }

  async query(
    request: PersonalFillOperationRequest<PersonalFillQueryMessage>,
  ): Promise<PersonalFillQueryResponse> {
    const failed: PersonalFillQueryResponse = {
      kind: PersonalFillQueryResponseKind.Failed,
    }
    const loaded = this.load(request.message.payload.requestId)
    switch (loaded.kind) {
      case PersonalPickerLoadKind.Unavailable:
        return failed
      case PersonalPickerLoadKind.Loaded:
        break
    }
    const { picker } = loaded
    const check: PersonalPickerSenderCheck = { picker, sender: request.sender }
    switch (
      request.message.payload.parentOrigin === picker.origin &&
      this.boundDocumentAdmission(check) === PersonalPickerAdmission.Admitted &&
      this.dependencies.generationIsCurrent(picker.authorizationGeneration)
    ) {
      case false:
        return failed
      case true:
        break
    }
    const listing: PersonalPickerGrantListing = {
      picker,
      grants: await this.allowedGrants(picker),
    }
    const response = await this.records(listing)
    switch (
      this.dependencies.generationIsCurrent(picker.authorizationGeneration)
    ) {
      case false:
        return failed
      case true:
        return response
    }
  }

  private async recordPresence(
    message: PersonalFillSelectMessage,
  ): Promise<PersonalPickerRecordPresence> {
    const loaded = this.load(message.payload.requestId)
    switch (loaded.kind) {
      case PersonalPickerLoadKind.Unavailable:
        return PersonalPickerRecordPresence.Absent
      case PersonalPickerLoadKind.Loaded:
        break
    }
    const grants = (await this.allowedGrants(loaded.picker)).filter(
      (grant) => grant.vaultStoreId === message.payload.vaultStoreId,
    )
    const listing: PersonalPickerGrantListing = {
      picker: loaded.picker,
      grants,
    }
    const response = await this.records(listing)
    switch (response.kind) {
      case PersonalFillQueryResponseKind.Failed:
        return PersonalPickerRecordPresence.Absent
      case PersonalFillQueryResponseKind.Ready:
        break
    }
    switch (
      response.records.some(
        (record) => record.secretId === message.payload.secretId,
      )
    ) {
      case true:
        return PersonalPickerRecordPresence.Present
      case false:
        return PersonalPickerRecordPresence.Absent
    }
  }

  async select(
    request: PersonalFillOperationRequest<PersonalFillSelectMessage>,
  ): Promise<PersonalFillSelectResponse> {
    const failed: PersonalFillSelectResponse = {
      kind: PersonalFillSelectResponseKind.Failed,
    }
    const { message } = request
    const loaded = this.load(message.payload.requestId)
    switch (loaded.kind) {
      case PersonalPickerLoadKind.Unavailable:
        return failed
      case PersonalPickerLoadKind.Loaded:
        break
    }
    const { picker } = loaded
    const check: PersonalPickerSenderCheck = { picker, sender: request.sender }
    switch (
      picker.document.kind === PersonalPickerDocumentKind.Bound &&
      this.boundDocumentAdmission(check) === PersonalPickerAdmission.Admitted &&
      picker.selection.kind === PersonalPickerSelectionKind.Pending
    ) {
      case false:
        return failed
      case true:
        break
    }
    const presence = await this.recordPresence(message)
    switch (
      presence === PersonalPickerRecordPresence.Present &&
      this.dependencies.generationIsCurrent(picker.authorizationGeneration) &&
      this.pickers.get(picker.requestId) === picker
    ) {
      case false:
        return failed
      case true:
        break
    }
    picker.selection = {
      kind: PersonalPickerSelectionKind.Selected,
      vaultStoreId: message.payload.vaultStoreId,
      secretId: message.payload.secretId,
    }
    const delivery: PersonalFillPageDelivery = {
      tabId: picker.tabId,
      frameId: picker.frameId,
      documentId: picker.parentDocumentId,
      message: {
        type: PersonalFillMessageType.Selected,
        payload: { origin: picker.origin, requestId: picker.requestId },
      },
    }
    const acknowledged = await this.dependencies
      .sendToPage(delivery)
      .catch(() => this.ignored())
    switch (acknowledged.kind) {
      case PersonalFillPageResponseKind.Acknowledged:
        return { kind: PersonalFillSelectResponseKind.Selected }
      case PersonalFillPageResponseKind.Ignored:
        this.pickers.delete(picker.requestId)
        return failed
    }
  }

  private ignored(): PersonalFillPageResponse {
    return { kind: PersonalFillPageResponseKind.Ignored }
  }

  async cancel(
    request: PersonalFillOperationRequest<PersonalFillCancelMessage>,
  ): Promise<PersonalFillCancelResponse> {
    const loaded = this.load(request.message.payload.requestId)
    switch (loaded.kind) {
      case PersonalPickerLoadKind.Unavailable:
        return { kind: PersonalFillCancelResponseKind.Canceled }
      case PersonalPickerLoadKind.Loaded:
        break
    }
    const { picker } = loaded
    const check: PersonalPickerSenderCheck = { picker, sender: request.sender }
    switch (this.parentAdmission(check)) {
      case PersonalPickerAdmission.Admitted:
        this.pickers.delete(picker.requestId)
        return { kind: PersonalFillCancelResponseKind.Canceled }
      case PersonalPickerAdmission.Forbidden:
        break
    }
    switch (
      picker.document.kind === PersonalPickerDocumentKind.Bound &&
      this.boundDocumentAdmission(check) === PersonalPickerAdmission.Admitted
    ) {
      case false:
        return { kind: PersonalFillCancelResponseKind.Forbidden }
      case true:
        break
    }
    this.pickers.delete(picker.requestId)
    const delivery: PersonalFillPageDelivery = {
      tabId: picker.tabId,
      frameId: picker.frameId,
      documentId: picker.parentDocumentId,
      message: {
        type: PersonalFillMessageType.Canceled,
        payload: { origin: picker.origin, requestId: picker.requestId },
      },
    }
    // The page may have navigated while its picker was open; the request is gone either way.
    await this.dependencies.sendToPage(delivery).catch(() => this.ignored())
    return { kind: PersonalFillCancelResponseKind.Canceled }
  }

  private wipe(response: PersonalFillRevealResponse): void {
    switch (response.kind) {
      case PersonalFillRevealResponseKind.Revealed:
        for (const value of response.values) {
          value.value = ''
        }
        return
      case PersonalFillRevealResponseKind.Locked:
      case PersonalFillRevealResponseKind.Failed:
        return
    }
  }

  /** Consumes the page's selected request and reveals only the planned kinds of that record. */
  async reveal(
    request: PersonalFillOperationRequest<PersonalFillRevealMessage>,
  ): Promise<PersonalFillRevealResponse> {
    const failed: PersonalFillRevealResponse = {
      kind: PersonalFillRevealResponseKind.Failed,
    }
    const locked: PersonalFillRevealResponse = {
      kind: PersonalFillRevealResponseKind.Locked,
    }
    const { message } = request
    const loaded = this.load(message.payload.requestId)
    switch (loaded.kind) {
      case PersonalPickerLoadKind.Unavailable:
        return failed
      case PersonalPickerLoadKind.Loaded:
        break
    }
    const { picker } = loaded
    const check: PersonalPickerSenderCheck = { picker, sender: request.sender }
    const selection = picker.selection
    switch (
      message.payload.origin === picker.origin &&
      this.parentAdmission(check) === PersonalPickerAdmission.Admitted
    ) {
      case false:
        return failed
      case true:
        break
    }
    switch (selection.kind) {
      case PersonalPickerSelectionKind.Pending:
        return failed
      case PersonalPickerSelectionKind.Selected:
        this.pickers.delete(picker.requestId)
        break
    }
    switch (
      this.dependencies.generationIsCurrent(picker.authorizationGeneration)
    ) {
      case false:
        return locked
      case true:
        break
    }
    const grants = (await this.allowedGrants(picker)).filter(
      (candidate) => candidate.vaultStoreId === selection.vaultStoreId,
    )
    for (const grant of grants) {
      const revealRequest: PersonalFillValueRevealRequest = {
        grant,
        secretId: selection.secretId,
        group: picker.group,
        kinds: message.payload.kinds,
      }
      const generated: PersonalPickerReveal = {
        picker,
        request: revealRequest,
      }
      return this.revealCurrent(generated)
    }
    return failed
  }

  private async revealCurrent(
    reveal: PersonalPickerReveal,
  ): Promise<PersonalFillRevealResponse> {
    const response = await this.dependencies.revealValues(reveal.request)
    switch (
      this.dependencies.generationIsCurrent(
        reveal.picker.authorizationGeneration,
      )
    ) {
      case true:
        return response
      case false:
        this.wipe(response)
        return { kind: PersonalFillRevealResponseKind.Locked }
    }
  }
}
