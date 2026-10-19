import type { VaultState } from "$lib/vault.svelte";
import type { SecretHistoryView } from "$lib/nook";
import {
  PasskeyDetailsPresentationKind,
  SecretHistoryPresentationKind,
  type PasskeyDetailsPresentation,
  type SecretHistoryPresentation,
} from "./secret-vault-state";

/** Public details and event-log history for the one selected passkey. */
export class PasskeyDetailSelection {
  details = $state<PasskeyDetailsPresentation>({
    kind: PasskeyDetailsPresentationKind.Hidden,
  });
  history = $state<SecretHistoryPresentation>({
    kind: SecretHistoryPresentationKind.Hidden,
  });

  constructor(private readonly currentVault: () => VaultState) {}

  /** Fetch both views for a newly selected passkey; each fails on its own. */
  select(id: string): void {
    void this.loadDetails(id);
    void this.loadHistory(id);
  }

  clear(): void {
    this.details = { kind: PasskeyDetailsPresentationKind.Hidden };
    this.history = { kind: SecretHistoryPresentationKind.Hidden };
  }

  detailsFor(itemId: string): PasskeyDetailsPresentation {
    return this.details.kind !== PasskeyDetailsPresentationKind.Hidden &&
      this.details.id === itemId
      ? this.details
      : { kind: PasskeyDetailsPresentationKind.Hidden };
  }

  historyFor(itemId: string): SecretHistoryPresentation {
    return this.history.kind !== SecretHistoryPresentationKind.Hidden &&
      this.history.id === itemId
      ? this.history
      : { kind: SecretHistoryPresentationKind.Hidden };
  }

  private async loadDetails(id: string): Promise<void> {
    this.details = { kind: PasskeyDetailsPresentationKind.Loading, id };
    const details = await this.currentVault().passkeyDetails(id);
    if (
      this.details.kind !== PasskeyDetailsPresentationKind.Loading ||
      this.details.id !== id
    )
      return;
    this.details = details.isOk()
      ? {
          kind: PasskeyDetailsPresentationKind.Loaded,
          id,
          details: details.value,
        }
      : { kind: PasskeyDetailsPresentationKind.Failed, id };
  }

  private async loadHistory(id: string): Promise<void> {
    this.history = { kind: SecretHistoryPresentationKind.Loading, id };
    const history = await this.currentVault().secretHistory(id);
    if (
      this.history.kind !== SecretHistoryPresentationKind.Loading ||
      this.history.id !== id
    )
      return;
    this.history =
      history.isOk() && PasskeyDetailSelection.datesReadable(history.value)
        ? {
            kind: SecretHistoryPresentationKind.Loaded,
            id,
            history: history.value,
          }
        : { kind: SecretHistoryPresentationKind.Failed, id };
  }

  /** An event time the browser cannot read is a failed history, not raw text. */
  private static datesReadable(history: SecretHistoryView): boolean {
    return (
      !Number.isNaN(Date.parse(history.originAt)) &&
      (history.modifiedAt === undefined ||
        !Number.isNaN(Date.parse(history.modifiedAt)))
    );
  }
}
