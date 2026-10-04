import { Effect, Fiber } from "effect";
import type { Result } from "neverthrow";
import type { VaultState } from "$lib/vault.svelte";
import type { VaultType } from "$lib/vault/architecture-model";
import {
  NativeVaultStorageFailure,
  type VaultStorageFailure,
} from "$lib/runtime/storage-failure";
import {
  SentinelUnlockActions,
  type SentinelCeremonyVisibility,
} from "./sentinel-unlock";

export enum SentinelLoginPresentationKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

interface SentinelLoginProjection {
  readonly vaultType: VaultType;
  readonly ceremonyVisibility: SentinelCeremonyVisibility;
}

type QueuedSentinelLoginRead = Effect.Effect<
  SentinelLoginProjection,
  VaultStorageFailure
>;

type SentinelLoginPresentation =
  | { readonly kind: SentinelLoginPresentationKind.Loading }
  | {
      readonly kind: SentinelLoginPresentationKind.Failed;
      readonly failure: VaultStorageFailure;
    }
  | {
      readonly kind: SentinelLoginPresentationKind.Ready;
      readonly projection: SentinelLoginProjection;
    };

type NativeLoginPresentationFailure = ConstructorParameters<
  typeof NativeVaultStorageFailure
>[0];

interface SentinelLoginReadAttempt {
  readonly try: () => Promise<
    Result<SentinelLoginProjection, VaultStorageFailure>
  >;
  readonly catch: (
    failure: NativeLoginPresentationFailure,
  ) => VaultStorageFailure;
}

interface SentinelLoginPublication {
  readonly onSuccess: (
    projection: SentinelLoginProjection,
  ) => Effect.Effect<void>;
  readonly onFailure: (failure: VaultStorageFailure) => Effect.Effect<void>;
}

/** Owns the queued native projection and its mounted login presentation. */
export class SentinelLoginPresentationReader {
  presentation = $state<SentinelLoginPresentation>({
    kind: SentinelLoginPresentationKind.Loading,
  });

  constructor(private readonly state: VaultState) {}

  private read(): Result<SentinelLoginProjection, VaultStorageFailure> {
    const actions = new SentinelUnlockActions(this.state);
    const vaultType = actions.vaultType();
    const ceremonyVisibility = actions.ceremonyVisibility();
    return vaultType.andThen((kind) =>
      ceremonyVisibility.map((visibility) => ({
        vaultType: kind,
        ceremonyVisibility: visibility,
      })),
    );
  }

  start(): () => void {
    void this.state.sentinelUnlockStatus;
    void this.state.isAuthenticated;
    void this.state.sentinelCeremonyPrompt;
    void this.state.vaultArchitecture;
    void this.state.hasManager;
    void this.state.sentinelUnlockSession;
    void this.state.selectedLoginVault;
    this.presentation = { kind: SentinelLoginPresentationKind.Loading };
    const publication: SentinelLoginPublication = {
      onSuccess: this.publishProjection.bind(this),
      onFailure: this.publishFailure.bind(this),
    };
    const fiber = Effect.runFork(
      this.readQueued().pipe(Effect.matchEffect(publication)),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }

  private readQueued(): QueuedSentinelLoginRead {
    const attempt: SentinelLoginReadAttempt = {
      try: () => this.state.enqueueStorage(() => this.read()),
      catch: (failure) => new NativeVaultStorageFailure(failure),
    };
    return Effect.tryPromise(attempt).pipe(
      Effect.flatMap((result) =>
        result.match<QueuedSentinelLoginRead>(Effect.succeed, Effect.fail),
      ),
    );
  }

  private publishProjection(
    projection: SentinelLoginProjection,
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      this.presentation = {
        kind: SentinelLoginPresentationKind.Ready,
        projection,
      };
    });
  }

  private publishFailure(failure: VaultStorageFailure): Effect.Effect<void> {
    return Effect.sync(() => {
      this.presentation = {
        kind: SentinelLoginPresentationKind.Failed,
        failure,
      };
      const message = this.state.t(failure.translationKey);
      switch (this.state.errorMsg) {
        case message:
          break;
        default:
          this.state.errorMsg = message;
      }
    });
  }
}
