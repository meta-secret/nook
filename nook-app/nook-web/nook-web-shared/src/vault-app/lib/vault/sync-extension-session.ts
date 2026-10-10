import { Effect, type Result as EffectResult } from "effect";
import { err, ok, type Result } from "neverthrow";
import { NookExternalEventLogRecords, type NookVaultManager } from "$app-wasm";
import type {
  ExtensionVaultEventLogResponse,
  ExtensionEventLogRecord,
} from "$app-wasm";
import type { ExtensionVaultEventLogChannel } from "$lib/extension/vault-event-log";
import {
  InstalledExtensionRuntimeKind,
  type InstalledExtensionRuntime,
} from "$lib/extension/connect";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { VaultType } from "$lib/vault/architecture-model";
import type { SessionActionsContext } from "$lib/vault/action-contexts";

type MergedEventLogResource = Pick<
  Awaited<ReturnType<NookVaultManager["sync_external_event_log_records_js"]>>,
  "free"
>;
type ExtensionSessionMergeManager = Pick<NookVaultManager, "vaultStoreId"> & {
  sync_external_event_log_records_js: (
    records: NookExternalEventLogRecords,
  ) => Promise<MergedEventLogResource>;
};
type ExtensionVaultSessionState = Pick<
  SessionActionsContext,
  "isAuthenticated" | "sessionEpoch" | "refreshSecretsFromSession"
> & {
  readonly vaultArchitecture: Pick<
    SessionActionsContext["vaultArchitecture"],
    "vault_type"
  >;
  admitManager: () => Result<ExtensionSessionMergeManager, VaultStorageFailure>;
  enqueueStorage<Value>(
    operation: () => Promise<Result<Value, VaultStorageFailure>>,
  ): Promise<Result<Value, VaultStorageFailure>>;
};
type ExtensionVaultSessionSynchronizationRequest = {
  readonly state: ExtensionVaultSessionState;
  readonly channel: Pick<ExtensionVaultEventLogChannel, "pull">;
  readonly installedRuntime: () => InstalledExtensionRuntime;
  readonly from_array: typeof NookExternalEventLogRecords.from_array;
};
type ExtensionVaultSessionContext = {
  readonly epoch: number;
  readonly vault_store_id: string;
};
type ExportedVaultEventLog = Extract<
  ExtensionVaultEventLogResponse,
  { event_log_records: ExtensionEventLogRecord[] }
>;
type ExtensionVaultSessionImport = ExtensionVaultSessionContext & {
  readonly exported: ExportedVaultEventLog;
};
type ExtensionVaultSessionPull = {
  readonly context: ExtensionVaultSessionContext;
  readonly pull: Parameters<ExtensionVaultEventLogChannel["pull"]>[0];
};
type ExtensionVaultSessionReceipt = {
  readonly context: ExtensionVaultSessionContext;
  readonly response: ExtensionVaultEventLogResponse;
};
type ExtensionVaultSessionManagerAdmission = {
  readonly context: ExtensionVaultSessionContext;
  readonly manager: ExtensionSessionMergeManager;
};
type AdmittedExtensionVaultSessionImport = {
  readonly request: ExtensionVaultSessionImport;
  readonly manager: ExtensionSessionMergeManager;
};
type ExtensionVaultSessionMergeResult = EffectResult.Result<
  ExtensionVaultSessionSynchronizationOutcome,
  VaultStorageFailure
>;

export enum ExtensionVaultSessionSynchronizationOutcome {
  NotRequired = "not-required",
  Synchronized = "synchronized",
}

enum ExtensionVaultSessionAdmission {
  Current = "current",
  Changed = "changed",
}

type ExtensionVaultSessionPublicationRequest = {
  readonly epoch: number;
  readonly state: Pick<
    SessionActionsContext,
    "sessionEpoch" | "errorMsg" | "t" | "publishExtensionEventLogUpdate"
  >;
};

/** Keeps a completed publication failure attached to the session that requested it. */
export class ExtensionVaultSessionPublication {
  constructor(
    private readonly request: ExtensionVaultSessionPublicationRequest,
  ) {}

  run(): Effect.Effect<void> {
    const attempt: {
      readonly try: () => ReturnType<
        SessionActionsContext["publishExtensionEventLogUpdate"]
      >;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      try: () => this.request.state.publishExtensionEventLogUpdate(),
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    return Effect.tryPromise(attempt).pipe(
      Effect.flatMap(this.admitResult.bind(this)),
      Effect.catch(this.reportFailure.bind(this)),
    );
  }

  private admitResult(
    result: Awaited<
      ReturnType<SessionActionsContext["publishExtensionEventLogUpdate"]>
    >,
  ): Effect.Effect<void, VaultStorageFailure> {
    return result.match(() => Effect.void, Effect.fail);
  }

  private reportFailure(failure: VaultStorageFailure): Effect.Effect<void> {
    return Effect.sync(this.writeFailure.bind(this, failure));
  }

  private writeFailure(failure: VaultStorageFailure): void {
    switch (this.request.state.sessionEpoch) {
      case this.request.epoch:
        this.request.state.errorMsg = this.request.state.t(
          failure.translationKey,
        );
        return;
      default:
        return;
    }
  }
}

/** Pulls the companion's committed ciphertext into the currently opened website session. */
export class ExtensionVaultSessionSynchronization {
  constructor(
    private readonly request: ExtensionVaultSessionSynchronizationRequest,
  ) {}

  run(): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    switch (this.request.state.vaultArchitecture.vault_type) {
      case VaultType.Sentinel:
        return Effect.succeed(
          ExtensionVaultSessionSynchronizationOutcome.NotRequired,
        );
      case VaultType.Simple:
        break;
    }
    const installed = this.request.installedRuntime();
    switch (installed.kind) {
      case InstalledExtensionRuntimeKind.NotInstalled:
        return Effect.succeed(
          ExtensionVaultSessionSynchronizationOutcome.NotRequired,
        );
      case InstalledExtensionRuntimeKind.Installed:
        break;
    }
    const manager = this.request.state.admitManager();
    return manager.match(
      (admitted) => {
        const context: ExtensionVaultSessionContext = {
          epoch: this.request.state.sessionEpoch,
          vault_store_id: admitted.vaultStoreId,
        };
        const pull: Parameters<ExtensionVaultEventLogChannel["pull"]>[0] = {
          extensionId: installed.extensionRuntimeId,
          vault_store_id: context.vault_store_id,
        };
        const transport: ExtensionVaultSessionPull = { context, pull };
        return this.pull(transport);
      },
      (failure) => Effect.fail(failure),
    );
  }

  private pull(
    transport: ExtensionVaultSessionPull,
  ): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    return this.request.channel.pull(transport.pull).pipe(
      Effect.flatMap((response) => {
        const receipt: ExtensionVaultSessionReceipt = {
          context: transport.context,
          response,
        };
        return this.receive(receipt);
      }),
    );
  }

  private receive(
    receipt: ExtensionVaultSessionReceipt,
  ): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    const { context, response } = receipt;
    switch (response.kind) {
      case "NotPaired":
        return Effect.succeed(
          ExtensionVaultSessionSynchronizationOutcome.NotRequired,
        );
      case "Rejected":
        return Effect.fail(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionPublicationFailed,
          ),
        );
      case "Exported": {
        const request: ExtensionVaultSessionImport = {
          ...context,
          exported: response,
        };
        return this.import(request);
      }
    }
  }

  private current(
    context: ExtensionVaultSessionContext,
  ): Result<ExtensionSessionMergeManager, VaultStorageFailure> {
    const state = this.request.state;
    const admission = this.observeSession(context);
    switch (admission) {
      case ExtensionVaultSessionAdmission.Changed:
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      case ExtensionVaultSessionAdmission.Current:
        break;
    }
    return state.admitManager().andThen((manager) => {
      const admitted: ExtensionVaultSessionManagerAdmission = {
        context,
        manager,
      };
      return this.currentStore(admitted);
    });
  }

  private observeSession(
    context: ExtensionVaultSessionContext,
  ): ExtensionVaultSessionAdmission {
    const state = this.request.state;
    switch (state.isAuthenticated && state.sessionEpoch === context.epoch) {
      case true:
        return ExtensionVaultSessionAdmission.Current;
      case false:
        return ExtensionVaultSessionAdmission.Changed;
    }
  }

  private currentStore(
    admitted: ExtensionVaultSessionManagerAdmission,
  ): Result<ExtensionSessionMergeManager, VaultStorageFailure> {
    const { context, manager } = admitted;
    switch (manager.vaultStoreId) {
      case context.vault_store_id:
        return ok(manager);
      default:
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
    }
  }

  private import(
    request: ExtensionVaultSessionImport,
  ): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    return Effect.gen(this.importProgram.bind(this, request));
  }

  private *importProgram(
    request: ExtensionVaultSessionImport,
  ): Effect.fn.Return<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    const current = this.current(request);
    yield* current.match(Effect.succeed, Effect.fail);
    const queued: {
      readonly try: () => Promise<
        Result<ExtensionVaultSessionSynchronizationOutcome, VaultStorageFailure>
      >;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      try: this.enqueueImport.bind(this, request),
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    const merged = yield* Effect.tryPromise(queued);
    yield* merged.match(Effect.succeed, Effect.fail);
    yield* this.current(request).match(Effect.succeed, Effect.fail);
    const refresh: {
      readonly try: () => ReturnType<
        SessionActionsContext["refreshSecretsFromSession"]
      >;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      try: () => this.request.state.refreshSecretsFromSession(),
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    const refreshed = yield* Effect.tryPromise(refresh);
    yield* refreshed.match(Effect.succeed, Effect.fail);
    yield* this.current(request).match(Effect.succeed, Effect.fail);
    return ExtensionVaultSessionSynchronizationOutcome.Synchronized;
  }

  private enqueueImport(
    request: ExtensionVaultSessionImport,
  ): Promise<
    Result<ExtensionVaultSessionSynchronizationOutcome, VaultStorageFailure>
  > {
    return this.request.state.enqueueStorage(
      this.mergeQueued.bind(this, request),
    );
  }

  private mergeQueued(
    request: ExtensionVaultSessionImport,
  ): Promise<
    Result<ExtensionVaultSessionSynchronizationOutcome, VaultStorageFailure>
  > {
    return Effect.runPromise(
      this.merge(request).pipe(
        Effect.result,
        Effect.map(this.mergeResult.bind(this)),
      ),
    );
  }

  private mergeResult(
    result: ExtensionVaultSessionMergeResult,
  ): Result<ExtensionVaultSessionSynchronizationOutcome, VaultStorageFailure> {
    switch (result._tag) {
      case "Success":
        return ok(result.success);
      case "Failure":
        return err(result.failure);
    }
  }

  private merge(
    request: ExtensionVaultSessionImport,
  ): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    const current = this.current(request);
    return current.match((manager) => {
      const admitted: AdmittedExtensionVaultSessionImport = {
        request,
        manager,
      };
      return this.mergeAdmitted(admitted);
    }, Effect.fail);
  }

  private mergeAdmitted(
    admitted: AdmittedExtensionVaultSessionImport,
  ): Effect.Effect<
    ExtensionVaultSessionSynchronizationOutcome,
    VaultStorageFailure
  > {
    const { request, manager } = admitted;
    const attempt: {
      readonly try: () => Promise<MergedEventLogResource>;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      // The generated WASM import consumes its input records wrapper.
      // Its returned resource is independently released by the scope below.
      try: () =>
        manager.sync_external_event_log_records_js(
          this.request.from_array(request.exported.event_log_records),
        ),
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    return Effect.acquireRelease(
      Effect.tryPromise(attempt),
      this.release.bind(this),
    ).pipe(
      Effect.as(ExtensionVaultSessionSynchronizationOutcome.Synchronized),
      Effect.scoped,
    );
  }

  private release(records: MergedEventLogResource): Effect.Effect<void> {
    return Effect.sync(records.free.bind(records));
  }
}
