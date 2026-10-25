import type { AuthorizedAccountList } from "$app-wasm";
import type { Result } from "neverthrow";
import type {
  AuthorizedAccountsAccess,
  AuthorizedAccountsFailure,
} from "$lib/vault/authorized-accounts";

export enum PanelStateKind {
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Loading = "loading",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Ready = "ready",
  /** @public Used from Svelte templates; Knip cannot trace enum members there. */
  Failed = "failed",
}

export type PanelState =
  | { kind: PanelStateKind.Loading }
  | {
      kind: PanelStateKind.Ready;
      access: AuthorizedAccountsAccess;
      accounts: AuthorizedAccountList;
    }
  | { kind: PanelStateKind.Failed; message: string };

/** A refreshed provider access list and the target it came from. */
export type AccountListRefresh = {
  readonly listed: Result<AuthorizedAccountList, AuthorizedAccountsFailure>;
  readonly access: AuthorizedAccountsAccess;
};
