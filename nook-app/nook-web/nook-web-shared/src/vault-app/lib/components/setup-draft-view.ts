import type { ProviderDraft } from "$app-wasm";
import type {
  GithubProviderDraft,
  LocalFolderProviderDraft,
  OAuthProviderDraft,
} from "$lib/vault/provider-draft-reads";

/** The setup form a host shows for the staged draft. */
export enum SetupDraftForm {
  ThisBrowser = "this-browser-form",
  LocalFolder = "local-folder-form",
  Github = "github-form",
  OAuth = "oauth-form",
  S3 = "s3-form",
}

/** The staged draft as the form that edits it, with that form's own draft. */
export type SetupDraftView =
  | { readonly kind: SetupDraftForm.ThisBrowser }
  | {
      readonly kind: SetupDraftForm.LocalFolder;
      readonly draft: LocalFolderProviderDraft;
    }
  | {
      readonly kind: SetupDraftForm.Github;
      readonly draft: GithubProviderDraft;
    }
  | { readonly kind: SetupDraftForm.OAuth; readonly draft: OAuthProviderDraft }
  | { readonly kind: SetupDraftForm.S3 };

/** Rust keeps the draft's kind equal to the setup's, so the draft picks the
 * form and each form gets exactly its own draft. */
export class SetupDraftViews {
  static of(draft: ProviderDraft): SetupDraftView {
    switch (draft.type) {
      case "local":
        return { kind: SetupDraftForm.ThisBrowser };
      case "local-folder":
        return { kind: SetupDraftForm.LocalFolder, draft };
      case "github":
        return { kind: SetupDraftForm.Github, draft };
      case "oauth-file":
        return { kind: SetupDraftForm.OAuth, draft };
      case "s3":
        return { kind: SetupDraftForm.S3 };
    }
  }
}
