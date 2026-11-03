import type { AuthorizedAccountList } from "$app-wasm";
import { authorizedAccountsClient } from "$lib/vault/authorized-accounts";

export enum SharedJoinerSelectionKind {
  None = "none",
  Selected = "selected",
}

/** The account a shared-provider invite names: none picked yet, or one the
 * provider listed with write access. */
export type SharedJoinerSelection =
  | { readonly kind: SharedJoinerSelectionKind.None }
  | {
      readonly kind: SharedJoinerSelectionKind.Selected;
      readonly email: string;
    };

export type SharedJoinerReconciliation = {
  readonly selection: SharedJoinerSelection;
  readonly accounts: AuthorizedAccountList;
};

export class SharedJoinerSelections {
  static readonly NONE: SharedJoinerSelection = {
    kind: SharedJoinerSelectionKind.None,
  };

  static selected(email: string): SharedJoinerSelection {
    return { kind: SharedJoinerSelectionKind.Selected, email };
  }

  /** Keep a picked account only while the refreshed list still invites it. */
  static reconcile({
    selection,
    accounts,
  }: SharedJoinerReconciliation): SharedJoinerSelection {
    switch (selection.kind) {
      case SharedJoinerSelectionKind.None:
        return selection;
      case SharedJoinerSelectionKind.Selected: {
        const choice: Parameters<
          typeof authorizedAccountsClient.inviteAccount
        >[0] = { accounts, email: selection.email };
        return authorizedAccountsClient.inviteAccount(choice).match(
          (email) => SharedJoinerSelections.selected(email),
          () => SharedJoinerSelections.NONE,
        );
      }
    }
  }
}
