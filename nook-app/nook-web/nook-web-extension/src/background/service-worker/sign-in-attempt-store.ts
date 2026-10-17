import { Effect, Schema, Semaphore } from 'effect'
import type { SignInAttemptStoredRecord } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { BrowserRuntimeMessageValue } from '../../lib/browser-runtime-message'

export enum StoredSignInAttemptKind {
  Absent = 'absent',
  Stored = 'stored',
  Unreadable = 'unreadable',
}
export type StoredSignInAttempt =
  | { readonly kind: StoredSignInAttemptKind.Absent }
  | {
      readonly kind: StoredSignInAttemptKind.Stored
      readonly record: SignInAttemptStoredRecord
    }
  | { readonly kind: StoredSignInAttemptKind.Unreadable }

export enum SignInAttemptStorageOperation {
  Load = 'load',
  Retain = 'retain',
  Remove = 'remove',
}

export class SignInAttemptStorageFailure extends Schema.TaggedError<SignInAttemptStorageFailure>()(
  'SignInAttemptStorageFailure',
  { operation: Schema.Enum(SignInAttemptStorageOperation) },
) {}

type SignInAttemptStoredValues = Readonly<
  Record<string, BrowserRuntimeMessageValue>
>
/** The `chrome.storage.session` operations the record owner uses. */
export interface SignInAttemptStorageArea {
  get(key: string): Promise<SignInAttemptStoredValues>
  set(values: SignInAttemptStoredValues): Promise<void>
  remove(key: string): Promise<void>
}
type SignInAttemptStoredEntry = {
  readonly key: string
  readonly values: SignInAttemptStoredValues
}

/**
 * Owns the opaque Rust record per tab in extension-only session storage.
 * The record string is stored and returned verbatim; Rust decodes it.
 */
export class SignInAttemptTabRecords {
  static readonly KEY_PREFIX = 'nook.extension.sign-in-attempt.'
  /** Chrome tab identity that owns at most one sign-in attempt record. */
  static readonly TAB_ID = Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.brand('SignInAttemptTabId'),
  )
  private readonly exclusive = Semaphore.makeUnsafe(1)

  constructor(private readonly storage: SignInAttemptStorageArea) {}

  /** One read-modify-write per transition, so a later event never overwrites an earlier one. */
  serialized<A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return this.exclusive.withPermit(operation)
  }

  load(tab: SignInAttemptTabId) {
    const key = this.key(tab)
    return Effect.tryPromise({
      try: () => this.storage.get(key),
      catch: () =>
        new SignInAttemptStorageFailure({
          operation: SignInAttemptStorageOperation.Load,
        }),
    }).pipe(
      Effect.map((values) => {
        const entry: SignInAttemptStoredEntry = { key, values }
        return this.decodeStored(entry)
      }),
    )
  }

  retain(retention: SignInAttemptRecordRetention) {
    const values: SignInAttemptStoredValues = {
      [this.key(retention.tab)]: retention.record,
    }
    return Effect.tryPromise({
      try: () => this.storage.set(values),
      catch: () =>
        new SignInAttemptStorageFailure({
          operation: SignInAttemptStorageOperation.Retain,
        }),
    })
  }

  remove(tab: SignInAttemptTabId) {
    const key = this.key(tab)
    return Effect.tryPromise({
      try: () => this.storage.remove(key),
      catch: () =>
        new SignInAttemptStorageFailure({
          operation: SignInAttemptStorageOperation.Remove,
        }),
    })
  }

  private key(tab: SignInAttemptTabId): string {
    return `${SignInAttemptTabRecords.KEY_PREFIX}${tab}`
  }

  private decodeStored(entry: SignInAttemptStoredEntry): StoredSignInAttempt {
    switch (entry.key in entry.values) {
      case false:
        return { kind: StoredSignInAttemptKind.Absent }
      case true:
        break
    }
    const stored = Schema.decodeUnknownOption(Schema.String)(
      entry.values[entry.key],
    )
    switch (stored._tag) {
      case 'None':
        return { kind: StoredSignInAttemptKind.Unreadable }
      case 'Some':
        return { kind: StoredSignInAttemptKind.Stored, record: stored.value }
    }
  }
}

export type SignInAttemptTabId = typeof SignInAttemptTabRecords.TAB_ID.Type

export type SignInAttemptRecordRetention = {
  readonly tab: SignInAttemptTabId
  readonly record: SignInAttemptStoredRecord
}
