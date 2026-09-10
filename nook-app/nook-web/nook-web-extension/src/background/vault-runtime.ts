import type { ExtensionEventLogRecord } from '../../../nook-web-shared/src/extension/runtime-messages'
import { companionWasmReady } from '../../../nook-web-shared/src/extension/companion-ready'
import {
  CompanionAuthenticationWorkflowMatchKind,
  classify_companion_authentication_outcome,
  classify_companion_authentication_outcome_with_default_timeout,
  classify_companion_authentication_workflow_facts,
  companion_authentication_workflow_match_kind,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type {
  AuthenticationOutcomeClassification,
  AuthenticationOutcomeObservation,
  AuthenticationPageObservationFactsBatch,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import initNookWasm, {
  configure_vault_application,
  admit_extension_storage_providers,
  default_password_generation_options,
  generate_password,
  read_extension_pairing_state,
  reconcile_extension_pairing_state,
  remove_extension_pairing_state,
  write_extension_pairing_state,
  NookExternalEventLogRecords,
  NookVaultManager,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type {
  ExtensionPairingState,
  StorageProvider,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { AuthenticationWorkflowSnapshotView } from '../lib/auth-workflow-messages'
import type {
  AuthenticationOutcomeObservationView,
  AuthenticationOutcomeVerdictView,
} from '../lib/outcome-evidence-messages'
import type {
  ExtensionSessionGrantIdentity,
  ExtensionPairingItems,
  ImportedEventLogState,
} from './pairing-grants'

enum BackgroundWasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type BackgroundWasmStartup =
  | { kind: BackgroundWasmStartupKind.NotStarted }
  | {
      kind: BackgroundWasmStartupKind.Initializing
      operation: Promise<void>
    }

export type ExtensionPairingStorageKeys = string[]

type ReconcileExtensionPairingItemsRequest = {
  items: ExtensionPairingItems
  removedKeys: string[]
}

export enum AuthenticationWorkflowSnapshotKind {
  Matched = 'matched',
  NoMatch = 'no-match',
}

export type AuthenticationWorkflowSnapshot =
  | { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
  | {
      kind: AuthenticationWorkflowSnapshotKind.Matched
      snapshot: AuthenticationWorkflowSnapshotView
    }

type AuthenticationOutcomeClassificationRequest = {
  observation: AuthenticationOutcomeObservationView
  timeoutMs: number
}

type ExtensionEventLogImportRequest = {
  grant: ExtensionSessionGrantIdentity
  records: ExtensionEventLogRecord[]
}

/** Owns the browser runtime resources shared by these interactions. */
class BackgroundVaultRuntime {
  private backgroundWasmStartup: BackgroundWasmStartup = {
    kind: BackgroundWasmStartupKind.NotStarted,
  }
  private ensureExtensionWasm(): Promise<void> {
    if (
      this.backgroundWasmStartup.kind === BackgroundWasmStartupKind.Initializing
    ) {
      return this.backgroundWasmStartup.operation
    }
    const nookTypedArgs0_0: Parameters<typeof initNookWasm>[0] = {
      module_or_path: chrome.runtime.getURL('background/nook_wasm_bg.wasm'),
    }
    const operation = initNookWasm(nookTypedArgs0_0).then(() => {
      configure_vault_application(VaultApplication.Extension)
    })
    this.backgroundWasmStartup = {
      kind: BackgroundWasmStartupKind.Initializing,
      operation,
    }
    return operation
  }

  private stateFromPairingItems(
    items: ExtensionPairingItems,
  ): ExtensionPairingState {
    return {
      entries: Object.entries(items).map(([key, record]) => ({ key, record })),
    }
  }

  private pairingItemsFromState(
    state: ExtensionPairingState,
  ): ExtensionPairingItems {
    return Object.fromEntries(
      state.entries.map(({ key, record }) => [key, record]),
    )
  }

  async loadExtensionPairingItems(): Promise<ExtensionPairingItems> {
    await this.ensureExtensionWasm()
    return this.pairingItemsFromState(await read_extension_pairing_state())
  }

  async persistExtensionPairingItems(
    items: ExtensionPairingItems,
  ): Promise<void> {
    await this.ensureExtensionWasm()
    await write_extension_pairing_state(this.stateFromPairingItems(items))
  }

  async deleteExtensionPairingItems(
    keys: ExtensionPairingStorageKeys,
  ): Promise<void> {
    await this.ensureExtensionWasm()
    await remove_extension_pairing_state(keys)
  }

  async reconcileExtensionPairingItems({
    items,
    removedKeys,
  }: ReconcileExtensionPairingItemsRequest): Promise<void> {
    await this.ensureExtensionWasm()
    await reconcile_extension_pairing_state(
      this.stateFromPairingItems(items),
      removedKeys,
    )
  }

  async authenticationWorkflowSnapshot(
    input: AuthenticationPageObservationFactsBatch,
  ): Promise<AuthenticationWorkflowSnapshot> {
    await companionWasmReady
    const workflowMatch =
      classify_companion_authentication_workflow_facts(input)
    const matchKind =
      companion_authentication_workflow_match_kind(workflowMatch)
    if (matchKind === CompanionAuthenticationWorkflowMatchKind.Rejected) {
      throw new Error('authentication workflow observations were rejected')
    }
    if (matchKind === CompanionAuthenticationWorkflowMatchKind.NoMatch) {
      return { kind: AuthenticationWorkflowSnapshotKind.NoMatch }
    }
    if (!('snapshot' in workflowMatch)) {
      throw new Error('authentication workflow match omitted its snapshot')
    }
    return {
      kind: AuthenticationWorkflowSnapshotKind.Matched,
      snapshot: workflowMatch.snapshot,
    }
  }

  async generateSuggestedPassword(): Promise<string> {
    await this.ensureExtensionWasm()
    return generate_password(default_password_generation_options())
  }

  async classifyAuthenticationOutcome({
    observation,
    timeoutMs,
  }: AuthenticationOutcomeClassificationRequest): Promise<AuthenticationOutcomeVerdictView> {
    await companionWasmReady
    const boundedObservation: AuthenticationOutcomeObservation = {
      ...observation,
      elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
    }
    const input: AuthenticationOutcomeClassification = {
      observation: boundedObservation,
      timeoutMs: Math.max(1, Math.floor(timeoutMs)),
    }
    return classify_companion_authentication_outcome(input)
  }

  async classifyAuthenticationOutcomeWithDefaultTimeout(
    observation: AuthenticationOutcomeObservationView,
  ): Promise<AuthenticationOutcomeVerdictView> {
    await companionWasmReady
    const boundedObservation: AuthenticationOutcomeObservation = {
      ...observation,
      elapsedMs: Math.max(0, Math.floor(observation.elapsedMs)),
    }
    return classify_companion_authentication_outcome_with_default_timeout(
      boundedObservation,
    )
  }

  async importExtensionEventLog({
    grant,
    records,
  }: ExtensionEventLogImportRequest): Promise<ImportedEventLogState> {
    await this.ensureExtensionWasm()
    const manager = new NookVaultManager()
    try {
      await manager.activate_local_identity_for_app_id(grant.deviceId)
      const recordValues = NookExternalEventLogRecords.from_array(records)
      const statusValue = await manager.import_extension_event_log_records_js(
        grant.vaultStoreId,
        grant.deviceId,
        grant.devicePublicKey,
        grant.deviceSigningPublicKey,
        recordValues,
      )
      try {
        return statusValue.to_object()
      } finally {
        statusValue.free()
      }
    } finally {
      manager.free()
    }
  }

  async decodeExtensionStorageProviders(
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Generated Rust collection crosses the WASM boundary directly.
    providers: StorageProvider[],
  ): Promise<StorageProvider[]> {
    await this.ensureExtensionWasm()
    return admit_extension_storage_providers(providers)
  }
}

export const backgroundVaultRuntime = new BackgroundVaultRuntime()
