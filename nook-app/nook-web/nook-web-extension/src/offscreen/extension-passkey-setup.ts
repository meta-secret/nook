import { Data, Effect } from 'effect'
import {
  DeviceMode,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  DeviceResult,
  SessionOperationContext,
} from './session-operations'
import { ExtensionSessionMessageType } from '../lib/extension-session-message-type'
import type { ExtensionSessionRequest } from './session-request-adapter'
import { PasskeyBrowserBytes } from './session-key-material'

type ExtensionPasskeySetupPayload = Extract<
  ExtensionSessionRequest,
  { type: typeof ExtensionSessionMessageType.FinishPasskeySetup }
>['payload']

export enum ExtensionPasskeySetupFailureKind {
  ManagerUnavailable = 'manager-unavailable',
  ProtectionFailed = 'protection-failed',
  AssociationFailed = 'association-failed',
  ActivationFailed = 'activation-failed',
}

type ExtensionPasskeySetupFailureRequest = {
  readonly kind: ExtensionPasskeySetupFailureKind
}

export class ExtensionPasskeySetupFailure extends Data.TaggedError(
  'ExtensionPasskeySetupFailure',
)<ExtensionPasskeySetupFailureRequest> {}

export type ExtensionPasskeySetupRequest = {
  readonly payload: ExtensionPasskeySetupPayload
  readonly context: Pick<
    SessionOperationContext,
    'getManager' | 'activateSession'
  >
}

type SetupPromiseAttempt<A> = {
  readonly try: () => Promise<A>
  readonly catch: () => ExtensionPasskeySetupFailure
}

/** Owns the browser setup sequence; Rust owns the protected wrapper and metadata. */
export class ExtensionPasskeySetup {
  constructor(private readonly request: ExtensionPasskeySetupRequest) {}

  readonly run = Effect.fnUntraced(function* (this: ExtensionPasskeySetup) {
    const managerAttempt: SetupPromiseAttempt<NookVaultManager> = {
      try: () => this.request.context.getManager(),
      catch: () =>
        this.failure(ExtensionPasskeySetupFailureKind.ManagerUnavailable),
    }
    const manager = yield* Effect.tryPromise(managerAttempt)
    yield* this.protect(manager)
    const recordAttempt: SetupPromiseAttempt<void> = {
      try: () =>
        manager.record_extension_passkey_creation(
          this.request.payload.passkeyLabel,
        ),
      catch: () =>
        this.failure(ExtensionPasskeySetupFailureKind.AssociationFailed),
    }
    yield* Effect.tryPromise(recordAttempt)
    const activationAttempt: SetupPromiseAttempt<DeviceResult> = {
      try: () => this.request.context.activateSession(),
      catch: () =>
        this.failure(ExtensionPasskeySetupFailureKind.ActivationFailed),
    }
    return yield* Effect.tryPromise(activationAttempt)
  })

  private protect(
    manager: NookVaultManager,
  ): Effect.Effect<void, ExtensionPasskeySetupFailure> {
    const payload = this.request.payload
    const credentialId = PasskeyBrowserBytes.fromWire(payload.credentialId)
    const userHandle = PasskeyBrowserBytes.fromWire(payload.userHandle)
    const prfInput = PasskeyBrowserBytes.fromWire(payload.prfInput)
    const prfOutput = PasskeyBrowserBytes.fromWire(payload.prfOutput)
    const attempt: SetupPromiseAttempt<void> = {
      try: () =>
        manager.finish_device_protection_with_mode(
          credentialId,
          userHandle,
          prfInput,
          prfOutput,
          payload.deviceMode as DeviceMode,
        ),
      catch: () =>
        this.failure(ExtensionPasskeySetupFailureKind.ProtectionFailed),
    }
    return Effect.tryPromise(attempt).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          credentialId.fill(0)
          userHandle.fill(0)
          prfInput.fill(0)
          prfOutput.fill(0)
        }),
      ),
    )
  }

  // Expose the failed stage without retaining native rejection details.
  private failure(
    kind: ExtensionPasskeySetupFailureKind,
  ): ExtensionPasskeySetupFailure {
    const request: ExtensionPasskeySetupFailureRequest = { kind }
    return new ExtensionPasskeySetupFailure(request)
  }
}
