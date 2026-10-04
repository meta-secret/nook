import type { VaultState } from "$lib/vault.svelte";
import { VaultType } from "$lib/vault/architecture-model";
import {
  SentinelCeremonyVisibility,
  SentinelUnlockActions,
} from "$lib/vault/sentinel-unlock";

export enum LoginVaultPresentationKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

type LoginVaultPresentationState =
  | { readonly kind: LoginVaultPresentationKind.Loading }
  | { readonly kind: LoginVaultPresentationKind.Failed }
  | {
      readonly kind: LoginVaultPresentationKind.Ready;
      readonly visibility: SentinelCeremonyVisibility;
      readonly vaultType: VaultType;
    };

/** Reads the login projection only after the current manager operation settles. */
export class LoginVaultPresentation {
  private state = $state<LoginVaultPresentationState>({
    kind: LoginVaultPresentationKind.Loading,
  });
  private generation = 0;

  constructor(private readonly vault: VaultState) {}

  get showSentinelCeremony(): boolean {
    switch (this.state.kind) {
      case LoginVaultPresentationKind.Loading:
      case LoginVaultPresentationKind.Failed:
        return false;
      case LoginVaultPresentationKind.Ready:
        return this.state.visibility === SentinelCeremonyVisibility.Visible;
    }
  }

  get hidePasswordUnlock(): boolean {
    switch (this.state.kind) {
      case LoginVaultPresentationKind.Loading:
      case LoginVaultPresentationKind.Failed:
        return true;
      case LoginVaultPresentationKind.Ready:
        return (
          this.showSentinelCeremony ||
          this.state.vaultType === VaultType.Sentinel
        );
    }
  }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.state = { kind: LoginVaultPresentationKind.Loading };
    const projection = await this.vault.enqueueStorage(() => {
      const actions = new SentinelUnlockActions(this.vault);
      return actions
        .ceremonyVisibility()
        .andThen((visibility) =>
          actions.vaultType().map((vaultType) => ({ visibility, vaultType })),
        );
    });
    switch (generation === this.generation) {
      case false:
        return;
      case true:
        break;
    }
    projection.match(
      (value) => {
        this.state = { kind: LoginVaultPresentationKind.Ready, ...value };
      },
      (error) => {
        this.state = { kind: LoginVaultPresentationKind.Failed };
        const message = this.vault.t(error.translationKey);
        switch (this.vault.errorMsg === message) {
          case true:
            break;
          case false:
            this.vault.errorMsg = message;
            break;
        }
      },
    );
  }

  release(): void {
    this.generation += 1;
  }
}
