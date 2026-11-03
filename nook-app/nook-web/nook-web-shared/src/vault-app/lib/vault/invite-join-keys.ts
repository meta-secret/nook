import type { ProviderDraft } from "$app-wasm";

/** Which key a provider whose key this device adds still needs. */
export enum InviteKeyKind {
  S3 = "s3",
  Github = "github",
}

/** A provider an invite names whose key this device adds: its draft knows
 * where it lives and waits for the key. */
export type InviteKeyProvider = {
  /** Its place in the invite's provider list. */
  readonly index: number;
  readonly kind: InviteKeyKind;
  readonly label: string;
  readonly draft: ProviderDraft;
};

/** Whether the join may go on without a typed key: another provider in the
 * invite carries its own, or none does and one key is needed. */
export enum InviteKeyNeed {
  Optional = "optional",
  AtLeastOne = "at-least-one",
}

export enum InviteKeyRequestKind {
  None = "none",
  Asked = "asked",
}

/** The keys the join screen asks for: none, or one form per provider of the
 * invite with this code whose key this device adds. */
export type InviteKeyRequest =
  | { readonly kind: InviteKeyRequestKind.None }
  | {
      readonly kind: InviteKeyRequestKind.Asked;
      readonly code: string;
      readonly need: InviteKeyNeed;
      readonly providers: readonly InviteKeyProvider[];
    };

/** What the join screen holds for one provider, as typed. */
export type InviteKeyEntry =
  | {
      readonly kind: InviteKeyKind.S3;
      readonly index: number;
      accessKeyId: string;
      secretAccessKey: string;
    }
  | {
      readonly kind: InviteKeyKind.Github;
      readonly index: number;
      token: string;
    };

/** A key request and the code a join submits. */
export type InviteKeyAsk = {
  readonly request: InviteKeyRequest;
  readonly code: string;
};

export class InviteKeyRequests {
  static readonly NONE: InviteKeyRequest = { kind: InviteKeyRequestKind.None };

  /** Whether the screen already asked for the keys of this code. */
  static asked({ request, code }: InviteKeyAsk): boolean {
    switch (request.kind) {
      case InviteKeyRequestKind.None:
        return false;
      case InviteKeyRequestKind.Asked:
        return request.code === code;
    }
  }

  /** One blank entry per provider the request asks a key for. */
  static blankEntries(request: InviteKeyRequest): InviteKeyEntry[] {
    switch (request.kind) {
      case InviteKeyRequestKind.None:
        return [];
      case InviteKeyRequestKind.Asked:
        return request.providers.map((provider) =>
          InviteKeyRequests.blankEntry(provider),
        );
    }
  }

  private static blankEntry(provider: InviteKeyProvider): InviteKeyEntry {
    switch (provider.kind) {
      case InviteKeyKind.S3:
        return {
          kind: InviteKeyKind.S3,
          index: provider.index,
          accessKeyId: "",
          secretAccessKey: "",
        };
      case InviteKeyKind.Github:
        return { kind: InviteKeyKind.Github, index: provider.index, token: "" };
    }
  }

  /** Whether anything was typed for this provider: an untouched form adds
   * no provider. */
  static typed(entry: InviteKeyEntry): boolean {
    switch (entry.kind) {
      case InviteKeyKind.S3:
        return entry.accessKeyId.trim() !== "" || entry.secretAccessKey !== "";
      case InviteKeyKind.Github:
        return entry.token.trim() !== "";
    }
  }
}
