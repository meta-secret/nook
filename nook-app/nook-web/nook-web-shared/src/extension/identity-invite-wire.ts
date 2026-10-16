export enum ExtensionIdentityInviteWireKind {
  /** The extension joins the identity with this invite. */
  Invited = "invited",
  /** The identity has no cloud sync provider to join through. */
  NeedsCloud = "needs-cloud",
  /** The approving web app predates identity connection. */
  NotOffered = "not-offered",
}

/** Structural browser wire value carried beside a pairing approval; the
 * approval admission in `runtime-messages` decodes it. */
export type ExtensionIdentityInviteWire =
  | {
      readonly kind: ExtensionIdentityInviteWireKind.Invited;
      readonly identityId: string;
      readonly identityLabel: string;
      readonly code: string;
      /** The code's passphrase, sealed to the extension's app key. */
      readonly sealedPassphrase: string;
      /** Id of the sealed provider (in the approval's providers) the
       * extension joins the identity through. */
      readonly mountProviderId: string;
    }
  | { readonly kind: ExtensionIdentityInviteWireKind.NeedsCloud }
  | { readonly kind: ExtensionIdentityInviteWireKind.NotOffered };
