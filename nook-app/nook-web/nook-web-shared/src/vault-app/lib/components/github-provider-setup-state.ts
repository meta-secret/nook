import { DEFAULT_GITHUB_REPO } from "$lib/auth/providers";
import type { GithubProviderDraft } from "$lib/vault/provider-draft-reads";

/** The text the GitHub form shows for a draft it did not type itself. */
export class GithubDraftText {
  static token(draft: GithubProviderDraft): string {
    switch (draft.token.state) {
      case "entered":
        return draft.token.value;
      case "awaitingToken":
        return "";
    }
  }

  static repository(draft: GithubProviderDraft): string {
    switch (draft.repository.state) {
      case "repository":
        return draft.repository.value;
      case "defaultRepository":
        return DEFAULT_GITHUB_REPO;
    }
  }

  /** Whether Rust took the typed token: the sync step opens with it. */
  static tokenEntered(draft: GithubProviderDraft): boolean {
    switch (draft.token.state) {
      case "entered":
        return true;
      case "awaitingToken":
        return false;
    }
  }
}
