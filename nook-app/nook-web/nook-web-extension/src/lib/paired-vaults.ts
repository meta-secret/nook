import { Effect, Schema } from 'effect'

/**
 * The vaults this extension is paired with, as the popup lists them. The
 * extension keeps one grant per vault; the default vault leads every list
 * and is where new logins are saved.
 */
export enum PairedVaultsMessageType {
  Query = 'nook:extension-paired-vaults-query',
  SelectDefault = 'nook:extension-default-vault-select',
  RefreshIdentity = 'nook:extension-identity-vaults-refresh',
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

/** After an unlock: pair the vaults the unlocked identity gained since. */
export type IdentityVaultsRefreshMessage = {
  readonly type: PairedVaultsMessageType.RefreshIdentity
  /** The unlocked extension device (its app id). */
  readonly deviceId: string
}
type IdentityVaultsRefreshMessageFields = {
  readonly type: Schema.Codec<IdentityVaultsRefreshMessage['type']>
  readonly deviceId: Schema.Codec<string>
}
const identityVaultsRefreshMessageFields: IdentityVaultsRefreshMessageFields = {
  type: Schema.Literal(PairedVaultsMessageType.RefreshIdentity),
  deviceId: Schema.String,
}
const identityVaultsRefreshMessageSchema = Schema.Struct(
  identityVaultsRefreshMessageFields,
) satisfies Schema.Codec<IdentityVaultsRefreshMessage>

export const pairedVaultsMessages = {
  decodeQuery(message: unknown) {
    return Schema.decodeUnknownEffect(pairedVaultsQueryMessageSchema)(message)
  },
  decodeSelectDefault(message: unknown) {
    return Schema.decodeUnknownEffect(defaultVaultSelectMessageSchema)(message)
  },
  decodeRefreshIdentity(message: unknown) {
    return Schema.decodeUnknownEffect(identityVaultsRefreshMessageSchema)(
      message,
    )
  },
}

export type PairedVaultSummary = {
  readonly vaultStoreId: string
  readonly vaultName: string
  /** The identity the vault belongs to; empty for vaults paired before
   * the extension recorded identities. */
  readonly identityLabel: string
  /** The extension's app key for that identity: one per identity. */
  readonly deviceId: string
  /** New logins are saved here, and it leads every list. */
  readonly isDefault: boolean
  readonly fillsPasswords: boolean
  readonly managesPasskeys: boolean
}
type PairedVaultSummaryFields = {
  readonly vaultStoreId: Schema.Codec<string>
  readonly vaultName: Schema.Codec<string>
  readonly identityLabel: Schema.Codec<string>
  readonly deviceId: Schema.Codec<string>
  readonly isDefault: Schema.Codec<boolean>
  readonly fillsPasswords: Schema.Codec<boolean>
  readonly managesPasskeys: Schema.Codec<boolean>
}
const pairedVaultSummaryFields: PairedVaultSummaryFields = {
  vaultStoreId: Schema.String,
  vaultName: Schema.String,
  identityLabel: Schema.String,
  deviceId: Schema.String,
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
const refusalSchema = Schema.Struct(
  refusalFields,
) satisfies Schema.Codec<Refusal>

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

type IdentityVaultsRefreshed = {
  readonly ok: true
  readonly paired: number
  readonly awaitingGrant: number
}
type IdentityVaultsRefreshedFields = {
  readonly ok: Schema.Codec<true>
  readonly paired: Schema.Codec<number>
  readonly awaitingGrant: Schema.Codec<number>
}
const identityVaultsRefreshedFields: IdentityVaultsRefreshedFields = {
  ok: Schema.Literal(true),
  paired: Schema.Number,
  awaitingGrant: Schema.Number,
}
export type IdentityVaultsRefreshResponse = IdentityVaultsRefreshed | Refusal
const identityVaultsRefreshResponseSchema = Schema.Union([
  Schema.Struct(identityVaultsRefreshedFields),
  refusalSchema,
]) satisfies Schema.Codec<IdentityVaultsRefreshResponse>

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

/** Paired vaults under one identity, as the popup lists them. */
export type PairedVaultGroup = {
  readonly identityLabel: string
  /** The extension's app key for the identity. */
  readonly deviceId: string
  readonly vaults: readonly PairedVaultSummary[]
}

/**
 * Group paired vaults by identity, keeping list order (so the default
 * vault's identity comes first). Vaults paired before the extension
 * recorded identities have none and come last.
 */
export function pairedVaultGroups(
  vaults: readonly PairedVaultSummary[],
): PairedVaultGroup[] {
  type GrowingGroup = {
    identityLabel: string
    deviceId: string
    vaults: PairedVaultSummary[]
  }
  const groups: GrowingGroup[] = []
  for (const vault of vaults) {
    const group = groups.find(
      (candidate) =>
        candidate.identityLabel === vault.identityLabel &&
        candidate.deviceId === vault.deviceId,
    )
    if (group) {
      group.vaults.push(vault)
      continue
    }
    const started: GrowingGroup = {
      identityLabel: vault.identityLabel,
      deviceId: vault.deviceId,
      vaults: [vault],
    }
    groups.push(started)
  }
  const named = groups.filter((group) => group.identityLabel !== '')
  const unnamed = groups.filter((group) => group.identityLabel === '')
  return [...named, ...unnamed]
}

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

  /** Pair the vaults the unlocked identity gained; the outcome, or the
   * refusal when the refresh failed. */
  refreshIdentity(deviceId: string): Promise<IdentityVaultsRefreshResponse> {
    const message: IdentityVaultsRefreshMessage = {
      type: PairedVaultsMessageType.RefreshIdentity,
      deviceId,
    }
    return new Promise((resolve) => {
      this.args.browser.chrome.runtime.sendMessage(
        message,
        (response: unknown) => {
          const failed: IdentityVaultsRefreshResponse = {
            ok: false,
            reason: 'identity-refresh-unavailable',
          }
          if (this.args.browser.chrome.runtime.lastError) {
            resolve(failed)
            return
          }
          const decoded = Effect.runSync(
            Effect.result(
              Schema.decodeUnknownEffect(identityVaultsRefreshResponseSchema)(
                response,
              ),
            ),
          )
          resolve(decoded._tag === 'Success' ? decoded.success : failed)
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
