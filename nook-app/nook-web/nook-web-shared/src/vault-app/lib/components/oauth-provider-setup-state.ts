import type { OAuthAccountIdentity } from "$lib/auth/providers";
import type { GoogleDriveSignIn, ICloudSignIn } from "$app-wasm";
import type { OAuthProviderDraft } from "$lib/vault/provider-draft-reads";

export type OAuthAccountTextRequest = {
  readonly draft: OAuthProviderDraft;
  /** The words shown when Rust knows no address for the account. */
  readonly unknownAccount: string;
};

type SignInTextRequest = {
  readonly signIn: GoogleDriveSignIn | ICloudSignIn;
  readonly unknownAccount: string;
};

type AccountWordsRequest = {
  readonly account: OAuthAccountIdentity;
  readonly unknownAccount: string;
};

/** What the OAuth setup shows for its Google Drive or iCloud draft. */
export class OAuthDraftView {
  static signedIn(draft: OAuthProviderDraft): boolean {
    switch (draft.preset) {
      case "google-drive":
        return OAuthDraftView.hasSignIn(draft.signIn);
      case "icloud":
        return OAuthDraftView.hasSignIn(draft.signIn);
    }
  }

  /** The Drive folder or iCloud share the vault syncs in is bound. */
  static targetReady(draft: OAuthProviderDraft): boolean {
    switch (draft.preset) {
      case "google-drive":
        return draft.folder.state === "connected";
      case "icloud":
        return draft.share.state === "shared";
    }
  }

  /** The signed-in account's address, or the given words. */
  static accountText({
    draft,
    unknownAccount,
  }: OAuthAccountTextRequest): string {
    const request: SignInTextRequest = { signIn: draft.signIn, unknownAccount };
    return OAuthDraftView.signInText(request);
  }

  private static hasSignIn(signIn: GoogleDriveSignIn | ICloudSignIn): boolean {
    switch (signIn.state) {
      case "signedIn":
        return true;
      case "awaitingSignIn":
        return false;
    }
  }

  private static signInText({
    signIn,
    unknownAccount,
  }: SignInTextRequest): string {
    switch (signIn.state) {
      case "signedIn": {
        const request: AccountWordsRequest = {
          account: signIn.value.account,
          unknownAccount,
        };
        return OAuthDraftView.accountWords(request);
      }
      case "awaitingSignIn":
        return unknownAccount;
    }
  }

  private static accountWords({
    account,
    unknownAccount,
  }: AccountWordsRequest): string {
    switch (account.state) {
      case "email":
        return account.email;
      case "unknown":
        return unknownAccount;
    }
  }
}
