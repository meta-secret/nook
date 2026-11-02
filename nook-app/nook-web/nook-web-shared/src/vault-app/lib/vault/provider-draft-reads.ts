import type {
  GoogleDriveAccess,
  GoogleDriveSignIn,
  ICloudSignIn,
  ProviderDraft,
  S3Connection,
} from "$app-wasm";

/** A draft of an OAuth file provider, Google Drive or iCloud. */
export type OAuthProviderDraft = Extract<ProviderDraft, { type: "oauth-file" }>;

export enum DraftDriveSignInKind {
  /** The draft is not a Google Drive draft, or it awaits its sign-in. */
  NotSignedIn = "not-signed-in",
  SignedIn = "signed-in",
}

export type DraftDriveSignIn =
  | { readonly kind: DraftDriveSignInKind.NotSignedIn }
  | {
      readonly kind: DraftDriveSignInKind.SignedIn;
      readonly access: GoogleDriveAccess;
    };

export enum DraftICloudSignInKind {
  /** The draft is not an iCloud draft. */
  NotICloud = "not-icloud",
  ICloud = "icloud",
}

export type DraftICloudSignIn =
  | { readonly kind: DraftICloudSignInKind.NotICloud }
  | {
      readonly kind: DraftICloudSignInKind.ICloud;
      readonly signIn: ICloudSignIn;
    };

/** Reads the sign-in a provider draft holds, for the browser calls that need
 * its token. Rust owns every decision over the draft itself. */
export class ProviderDraftReads {
  static driveSignIn(draft: ProviderDraft): DraftDriveSignIn {
    switch (draft.type) {
      case "oauth-file":
        return ProviderDraftReads.oauthDriveSignIn(draft);
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return { kind: DraftDriveSignInKind.NotSignedIn };
    }
  }

  static icloudSignIn(draft: ProviderDraft): DraftICloudSignIn {
    switch (draft.type) {
      case "oauth-file":
        return ProviderDraftReads.oauthICloudSignIn(draft);
      case "local":
      case "local-folder":
      case "github":
      case "s3":
        return { kind: DraftICloudSignInKind.NotICloud };
    }
  }

  private static oauthDriveSignIn(draft: OAuthProviderDraft): DraftDriveSignIn {
    switch (draft.preset) {
      case "google-drive":
        return ProviderDraftReads.signedInDrive(draft.signIn);
      case "icloud":
        return { kind: DraftDriveSignInKind.NotSignedIn };
    }
  }

  private static signedInDrive(signIn: GoogleDriveSignIn): DraftDriveSignIn {
    switch (signIn.state) {
      case "signedIn":
        return { kind: DraftDriveSignInKind.SignedIn, access: signIn.value };
      case "awaitingSignIn":
        return { kind: DraftDriveSignInKind.NotSignedIn };
    }
  }

  private static oauthICloudSignIn(
    draft: OAuthProviderDraft,
  ): DraftICloudSignIn {
    switch (draft.preset) {
      case "icloud":
        return { kind: DraftICloudSignInKind.ICloud, signIn: draft.signIn };
      case "google-drive":
        return { kind: DraftICloudSignInKind.NotICloud };
    }
  }
}

/** A GitHub provider draft. */
export type GithubProviderDraft = Extract<ProviderDraft, { type: "github" }>;

/** A local-folder provider draft. */
export type LocalFolderProviderDraft = Extract<
  ProviderDraft,
  { type: "local-folder" }
>;

export enum DraftS3ConnectionKind {
  /** The draft is not an S3 draft, or its form has not connected yet. */
  NotReady = "not-ready",
  Ready = "ready",
}

export type DraftS3Connection =
  | { readonly kind: DraftS3ConnectionKind.NotReady }
  | {
      readonly kind: DraftS3ConnectionKind.Ready;
      readonly connection: S3Connection;
    };

/** An S3 provider draft. */
type S3ProviderDraft = Extract<ProviderDraft, { type: "s3" }>;

/** Reads the connection an S3 draft holds once Rust validated its form. */
export class S3DraftReads {
  static connection(draft: ProviderDraft): DraftS3Connection {
    switch (draft.type) {
      case "s3":
        return S3DraftReads.ready(draft);
      case "local":
      case "local-folder":
      case "github":
      case "oauth-file":
        return { kind: DraftS3ConnectionKind.NotReady };
    }
  }

  private static ready(draft: S3ProviderDraft): DraftS3Connection {
    switch (draft.state) {
      case "ready":
        // The draft carries its tags beside the connection; Rust decodes the
        // connection alone.
        return {
          kind: DraftS3ConnectionKind.Ready,
          connection: {
            endpoint: draft.endpoint,
            region: draft.region,
            bucket: draft.bucket,
            keyPrefix: draft.keyPrefix,
            accessKeyId: draft.accessKeyId,
            secretAccessKey: draft.secretAccessKey,
          },
        };
      case "awaitingConnection":
        return { kind: DraftS3ConnectionKind.NotReady };
    }
  }
}
