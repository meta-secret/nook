import { Effect } from 'effect'
import {
  DeviceProtectionStatus,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  ExportVaultEventLogPayload,
  ExtensionVaultEventLogResponse,
  ExtensionVaultEventLogFailure,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ExportedEventLogResource = Pick<
  Awaited<ReturnType<NookVaultManager['export_event_log_records_js']>>,
  'to_array' | 'free'
>
type SessionEventLogExportManager = Pick<
  NookVaultManager,
  'device_protection_status' | 'open_extension_passkey_vault_js'
> & {
  export_event_log_records_js: () => Promise<ExportedEventLogResource>
}
export type SessionVaultEventLogExportRequest = {
  readonly manager: SessionEventLogExportManager
  readonly payload: ExportVaultEventLogPayload
}
type ExportFailure = Extract<
  ExtensionVaultEventLogResponse,
  { reason: ExtensionVaultEventLogFailure }
>
type ExportAttempt<Value> = {
  readonly try: () => Promise<Value>
  readonly catch: () => ExportFailure
}

/** Exports ciphertext only after Rust revalidates this protected device's live access. */
export class SessionVaultEventLogExport {
  constructor(private readonly request: SessionVaultEventLogExportRequest) {}

  run(): Effect.Effect<ExtensionVaultEventLogResponse> {
    const status: ExportAttempt<DeviceProtectionStatus> = {
      try: () => this.request.manager.device_protection_status(),
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    return Effect.tryPromise(status).pipe(
      Effect.flatMap(this.admit.bind(this)),
      Effect.catch((failure) => Effect.succeed(failure)),
    )
  }

  private admit(
    status: DeviceProtectionStatus,
  ): Effect.Effect<ExtensionVaultEventLogResponse, ExportFailure> {
    switch (status) {
      case DeviceProtectionStatus.Unlocked:
        break
      case DeviceProtectionStatus.Loading:
      case DeviceProtectionStatus.Missing:
      case DeviceProtectionStatus.Plaintext:
      case DeviceProtectionStatus.Passkey:
      case DeviceProtectionStatus.Pin:
      case DeviceProtectionStatus.PinSetup:
      case DeviceProtectionStatus.Error: {
        const locked: ExportFailure = { kind: 'Rejected', reason: 'Locked' }
        return Effect.succeed(locked)
      }
    }
    const { manager, payload } = this.request
    const admission: ExportAttempt<void> = {
      try: () =>
        manager.open_extension_passkey_vault_js(
          payload.vault_store_id,
          payload.app_id,
          payload.app_public_key,
          payload.app_signing_public_key,
        ),
      catch: () => ({ kind: 'Rejected', reason: 'AccessDenied' }),
    }
    return Effect.tryPromise(admission).pipe(
      Effect.flatMap(() => this.exportRecords()),
    )
  }

  private exportRecords(): Effect.Effect<
    ExtensionVaultEventLogResponse,
    ExportFailure
  > {
    const attempt: ExportAttempt<ExportedEventLogResource> = {
      try: () => this.request.manager.export_event_log_records_js(),
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    const acquired = Effect.acquireRelease(
      Effect.tryPromise(attempt),
      this.release.bind(this),
    )
    return acquired.pipe(Effect.flatMap(this.convert.bind(this)), Effect.scoped)
  }

  private release(records: ExportedEventLogResource): Effect.Effect<void> {
    return Effect.sync(records.free.bind(records))
  }

  private convert(
    records: ExportedEventLogResource,
  ): Effect.Effect<ExtensionVaultEventLogResponse, ExportFailure> {
    const conversion: {
      readonly try: () => ExtensionVaultEventLogResponse
      readonly catch: () => ExportFailure
    } = {
      try: () => ({
        kind: 'Exported',
        vault_store_id: this.request.payload.vault_store_id,
        event_log_records: records.to_array(),
      }),
      catch: () => ({ kind: 'Rejected', reason: 'Failed' }),
    }
    return Effect.try(conversion)
  }
}
