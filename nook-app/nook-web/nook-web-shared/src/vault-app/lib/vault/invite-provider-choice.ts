import type { EnrollmentCredentialChoice, S3Connection } from "$app-wasm";
import type { StorageProvider } from "$lib/auth/providers";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { SharedJoinerSelection } from "$lib/vault/shared-joiner-selection";

export enum InviteProviderChoiceKind {
  /** The invite carries the provider and the key chosen for it. */
  Personal = "personal",
  /** The invite names a shared target and an authorized account. */
  Shared = "shared",
}

/** One provider the inviter put in the invite, with what it chose for it. */
export type InviteProviderChoice =
  | {
      readonly kind: InviteProviderChoiceKind.Personal;
      readonly providerId: string;
      readonly credential: EnrollmentCredentialChoice;
    }
  | {
      readonly kind: InviteProviderChoiceKind.Shared;
      readonly providerId: string;
      readonly joiner: SharedJoinerSelection;
    };

export enum InviteChoiceShapeKind {
  /** An S3 row: this device's key, a saved spare, or none. */
  S3Key = "s3-key",
  /** A GitHub row: this device's token or none. */
  GithubToken = "github-token",
  /** A Google Drive or iCloud row: an authorized account. */
  SharedAccount = "shared-account",
  /** A provider whose invite has nothing to choose. */
  Fixed = "fixed",
}

export type InviteChoiceShape =
  | {
      readonly kind: InviteChoiceShapeKind.S3Key;
      readonly connection: S3Connection;
    }
  | { readonly kind: InviteChoiceShapeKind.GithubToken }
  | { readonly kind: InviteChoiceShapeKind.SharedAccount }
  | { readonly kind: InviteChoiceShapeKind.Fixed };

/** One choice of the key select, with the words it shows. */
export type InviteKeyOption = {
  readonly value: string;
  readonly labelKey: string;
  readonly id: string;
  readonly choice: EnrollmentCredentialChoice;
};

const INVITER: EnrollmentCredentialChoice = { kind: "inviter" };
const JOINER_PROVIDES: EnrollmentCredentialChoice = { kind: "joinerProvides" };

export class InviteProviderChoices {
  static readonly INVITER = INVITER;

  static shapeOf(provider: StorageProvider): InviteChoiceShape {
    const stored = provider.provider;
    switch (stored.type) {
      case "s3":
        return { kind: InviteChoiceShapeKind.S3Key, connection: stored };
      case "github":
        return { kind: InviteChoiceShapeKind.GithubToken };
      case "oauth-file":
        return { kind: InviteChoiceShapeKind.SharedAccount };
      case "local":
      case "local-folder":
        return { kind: InviteChoiceShapeKind.Fixed };
    }
  }

  /** The key select of an S3 row: this device's key first, then each
   * spare, then none. */
  static s3Options(connection: S3Connection): InviteKeyOption[] {
    const mine: InviteKeyOption = {
      value: "inviter",
      labelKey: I18N_KEYS.OnboardDeviceInviteKeyMine,
      id: connection.accessKeyId,
      choice: INVITER,
    };
    const spares = connection.spareKeys.map((spare): InviteKeyOption => ({
      value: `saved:${spare.accessKeyId}`,
      labelKey: I18N_KEYS.OnboardDeviceInviteKeySpare,
      id: spare.accessKeyId,
      choice: { kind: "savedKey", accessKeyId: spare.accessKeyId },
    }));
    const none: InviteKeyOption = {
      value: "joiner",
      labelKey: I18N_KEYS.OnboardDeviceInviteKeyJoiner,
      id: "",
      choice: JOINER_PROVIDES,
    };
    return [mine, ...spares, none];
  }

  /** The token select of a GitHub row. */
  static githubOptions(): InviteKeyOption[] {
    const mine: InviteKeyOption = {
      value: "inviter",
      labelKey: I18N_KEYS.OnboardDeviceInviteTokenMine,
      id: "",
      choice: INVITER,
    };
    const none: InviteKeyOption = {
      value: "joiner",
      labelKey: I18N_KEYS.OnboardDeviceInviteTokenJoiner,
      id: "",
      choice: JOINER_PROVIDES,
    };
    return [mine, none];
  }

  /** The select value of a choice. */
  static valueOf(choice: EnrollmentCredentialChoice): string {
    switch (choice.kind) {
      case "inviter":
        return "inviter";
      case "savedKey":
        return `saved:${choice.accessKeyId}`;
      case "joinerProvides":
        return "joiner";
    }
  }
}
