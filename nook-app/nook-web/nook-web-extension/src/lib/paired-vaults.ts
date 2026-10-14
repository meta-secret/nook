import { Effect, Schema } from 'effect'

/**
 * The vaults this extension is paired with, as the popup lists them. The
 * extension keeps one grant per vault; the default vault leads every list
 * and is where new logins are saved.
 */
export enum PairedVaultsMessageType {
  Query = 'nook:extension-paired-vaults-query',
  SelectDefault = 'nook:extension-default-vault-select',
}

export type PairedVaultsQueryMessage = {
  readonly type: PairedVaultsMessageType.Query
}
type PairedVaultsQueryMessageFields = {
  readonly type: Schema.Codec<PairedVaultsQueryMessage['type']>
}
const pairedVaultsQueryMessageFields: PairedVaultsQueryMessageFields = {
  type: Schema.Literal(PairedVaultsMessageType.Query),
}
const pairedVaultsQueryMessageSchema = Schema.Struct(
  pairedVaultsQueryMessageFields,
) satisfies Schema.Codec<PairedVaultsQueryMessage>

export type DefaultVaultSelectMessage = {
  readonly type: PairedVaultsMessageType.SelectDefault
  readonly vaultStoreId: string
}
type DefaultVaultSelectMessageFields = {
  readonly type: Schema.Codec<DefaultVaultSelectMessage['type']>
  readonly vaultStoreId: Schema.Codec<string>
}
const defaultVaultSelectMessageFields: DefaultVaultSelectMessageFields = {
  type: Schema.Literal(PairedVaultsMessageType.SelectDefault),
  vaultStoreId: Schema.String,
}
const defaultVaultSelectMessageSchema = Schema.Struct(
  defaultVaultSelectMessageFields,
) satisfies Schema.Codec<DefaultVaultSelectMessage>

export const pairedVaultsMessages = {
  decodeQuery(message: unknown) {
    return Schema.decodeUnknownEffect(pairedVaultsQueryMessageSchema)(message)
  },
  decodeSelectDefault(message: unknown) {
    return Schema.decodeUnknownEffect(defaultVaultSelectMessageSchema)(message)
  },
}

export type PairedVaultSummary = {
  readonly vaultStoreId: string
  readonly vaultName: string
  /** New logins are saved here, and it leads every list. */
  readonly isDefault: boolean
  readonly fillsPasswords: boolean
  readonly managesPasskeys: boolean
}
type PairedVaultSummaryFields = {
  readonly vaultStoreId: Schema.Codec<string>
  readonly vaultName: Schema.Codec<string>
  readonly isDefault: Schema.Codec<boolean>
  readonly fillsPasswords: Schema.Codec<boolean>
  readonly managesPasskeys: Schema.Codec<boolean>
}
const pairedVaultSummaryFields: PairedVaultSummaryFields = {
  vaultStoreId: Schema.String,
  vaultName: Schema.String,
  isDefault: Schema.Boolean,
  fillsPasswords: Schema.Boolean,
  managesPasskeys: Schema.Boolean,
}
const pairedVaultSummarySchema = Schema.Struct(
  pairedVaultSummaryFields,
) satisfies Schema.Codec<PairedVaultSummary>

type Refusal = { readonly ok: false; readonly reason: string }
type RefusalFields = {
  readonly ok: Schema.Codec<false>
  readonly reason: Schema.Codec<string>
}
const refusalFields: RefusalFields = {
  ok: Schema.Literal(false),
  reason: Schema.String,
}
const refusalSchema = Schema.Struct(refusalFields) satisfies Schema.Codec<Refusal>

type PairedVaultsListed = {
  readonly ok: true
  readonly vaults: readonly PairedVaultSummary[]
}
type PairedVaultsListedFields = {
  readonly ok: Schema.Codec<true>
  readonly vaults: Schema.Codec<readonly PairedVaultSummary[]>
}
const pairedVaultsListedFields: PairedVaultsListedFields = {
  ok: Schema.Literal(true),
  vaults: Schema.Array(pairedVaultSummarySchema),
}
export type PairedVaultsResponse = PairedVaultsListed | Refusal
const pairedVaultsResponseSchema = Schema.Union([
  Schema.Struct(pairedVaultsListedFields),
  refusalSchema,
]) satisfies Schema.Codec<PairedVaultsResponse>

type DefaultVaultSelected = { readonly ok: true }
type DefaultVaultSelectedFields = { readonly ok: Schema.Codec<true> }
const defaultVaultSelectedFields: DefaultVaultSelectedFields = {
  ok: Schema.Literal(true),
}
export type DefaultVaultSelectResponse = DefaultVaultSelected | Refusal
const defaultVaultSelectResponseSchema = Schema.Union([
  Schema.Struct(defaultVaultSelectedFields),
  refusalSchema,
]) satisfies Schema.Codec<DefaultVaultSelectResponse>

export enum PairedVaultsLoadKind {
  Ready = 'ready',
  Unavailable = 'unavailable',
}

export type PairedVaultsLoad =
  | {
      readonly kind: PairedVaultsLoadKind.Ready
      readonly vaults: readonly PairedVaultSummary[]
    }
  | { readonly kind: PairedVaultsLoadKind.Unavailable }

type PairedVaultsClientArgs = { readonly browser: typeof globalThis }

/** The popup's view of the paired vaults, through the service worker. */
export class PairedVaultsClient {
  constructor(private readonly args: PairedVaultsClientArgs) {}

  list(): Promise<PairedVaultsLoad> {
    const message: PairedVaultsQueryMessage = {
      type: PairedVaultsMessageType.Query,
    }
    return new Promise((resolve) => {
      this.args.browser.chrome.runtime.sendMessage(
        message,
        (response: unknown) => {
          const unavailable: PairedVaultsLoad = {
            kind: PairedVaultsLoadKind.Unavailable,
          }
          if (this.args.browser.chrome.runtime.lastError) {
            resolve(unavailable)
            return
          }
          const decoded = Effect.runSync(
            Effect.result(
              Schema.decodeUnknownEffect(pairedVaultsResponseSchema)(response),
            ),
          )
          if (decoded._tag === 'Failure' || !decoded.success.ok) {
            resolve(unavailable)
            return
          }
          const ready: PairedVaultsLoad = {
            kind: PairedVaultsLoadKind.Ready,
            vaults: decoded.success.vaults,
          }
          resolve(ready)
        },
      )
    })
  }

  makeDefault(vaultStoreId: string): Promise<boolean> {
    const message: DefaultVaultSelectMessage = {
      type: PairedVaultsMessageType.SelectDefault,
      vaultStoreId,
    }
    return new Promise((resolve) => {
      this.args.browser.chrome.runtime.sendMessage(
        message,
        (response: unknown) => {
          if (this.args.browser.chrome.runtime.lastError) {
            resolve(false)
            return
          }
          const decoded = Effect.runSync(
            Effect.result(
              Schema.decodeUnknownEffect(defaultVaultSelectResponseSchema)(
                response,
              ),
            ),
          )
          resolve(decoded._tag === 'Success' && decoded.success.ok)
        },
      )
    })
  }
}

const pairedVaultsClientArgs: PairedVaultsClientArgs = { browser: globalThis }
export const pairedVaultsClient = new PairedVaultsClient(pairedVaultsClientArgs)
