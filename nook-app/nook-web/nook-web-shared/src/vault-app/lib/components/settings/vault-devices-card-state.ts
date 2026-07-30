import type { ExtensionSetupState } from "$lib/extension-install";

export enum MemberDetailsKind {
  Collapsed = "collapsed",
  Expanded = "expanded",
}

export type MemberDetails =
  | { kind: MemberDetailsKind.Collapsed }
  | { kind: MemberDetailsKind.Expanded; authId: string };

export enum MemberRenameKind {
  Idle = "idle",
  Editing = "editing",
}

export type MemberRename =
  | { kind: MemberRenameKind.Idle }
  | { kind: MemberRenameKind.Editing; authId: string };

export enum MemberRevocationKind {
  Idle = "idle",
  Confirming = "confirming",
}

export type MemberRevocation =
  | { kind: MemberRevocationKind.Idle }
  | { kind: MemberRevocationKind.Confirming; authId: string };

export enum ExtensionSetupOfferKind {
  Hidden = "hidden",
  Visible = "visible",
}

export type ExtensionSetupOffer =
  | { kind: ExtensionSetupOfferKind.Hidden }
  | { kind: ExtensionSetupOfferKind.Visible; setup: ExtensionSetupState };
