import { Data, Effect, Schema, Semaphore } from 'effect'
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

type SignInAttemptStorageFailureFields = {
  readonly operation: SignInAttemptStorageOperation
}

export class SignInAttemptStorageFailure extends Data.TaggedError(
  'SignInAttemptStorageFailure',
)<SignInAttemptStorageFailureFields> {}

type SignInAttemptStorageCall<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => SignInAttemptStorageFailure
}

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
    const call: SignInAttemptStorageCall<SignInAttemptStoredValues> = {
      try: () => this.storage.get(key),
      catch: () => this.failure(SignInAttemptStorageOperation.Load),
    }
    return Effect.tryPromise(call).pipe(
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
    const call: SignInAttemptStorageCall<void> = {
      try: () => this.storage.set(values),
      catch: () => this.failure(SignInAttemptStorageOperation.Retain),
    }
    return Effect.tryPromise(call)
  }

  remove(tab: SignInAttemptTabId) {
    const key = this.key(tab)
    const call: SignInAttemptStorageCall<void> = {
      try: () => this.storage.remove(key),
      catch: () => this.failure(SignInAttemptStorageOperation.Remove),
    }
    return Effect.tryPromise(call)
  }

  private failure(
    operation: SignInAttemptStorageOperation,
  ): SignInAttemptStorageFailure {
    const fields: SignInAttemptStorageFailureFields = { operation }
    return new SignInAttemptStorageFailure(fields)
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
