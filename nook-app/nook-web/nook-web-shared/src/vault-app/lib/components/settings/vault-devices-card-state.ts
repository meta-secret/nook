import type { IdentityMemberApprovalView } from "$app-wasm";

export enum MemberDetailsKind {
  Collapsed = "collapsed",
  Expanded = "expanded",
}

export type MemberDetails =
  | { kind: MemberDetailsKind.Collapsed }
  | { kind: MemberDetailsKind.Expanded; appId: string };

export enum MemberRenameKind {
  Idle = "idle",
  Editing = "editing",
}

export type MemberRename =
  | { kind: MemberRenameKind.Idle }
  | { kind: MemberRenameKind.Editing; appId: string };

export enum MemberRevocationKind {
  Idle = "idle",
  Confirming = "confirming",
}

export type MemberRevocation =
  | { kind: MemberRevocationKind.Idle }
  | { kind: MemberRevocationKind.Confirming; appId: string };

export enum MemberApprovalTagKind {
  /** Its approval needs no tag of its own. */
  Plain = "plain",
  /** A recovery passphrase let it in, named by its label. */
  Recovered = "recovered",
}

export type MemberApprovalTag =
  | { kind: MemberApprovalTagKind.Plain }
  | { kind: MemberApprovalTagKind.Recovered; label: string };

/** The tag a device row shows for who let the app in. */
export function memberApprovalTag(
  approvedBy: IdentityMemberApprovalView,
): MemberApprovalTag {
  switch (approvedBy.kind) {
    case "founder":
    case "invite":
    case "app":
      return { kind: MemberApprovalTagKind.Plain };
    case "recoveryPassphrase":
      return {
        kind: MemberApprovalTagKind.Recovered,
        label: approvedBy.label,
      };
  }
}
