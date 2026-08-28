import { NookIdentityLocalAccessKind } from "$app-wasm";
import type { IdentityDirectoryEntry } from "../devices-access/identity-directory-view";

export enum LoginVaultIdentityContextKind {
  Loading = "loading",
  Failed = "failed",
  Empty = "empty",
  LinkedWithoutCurrent = "linked-without-current",
  LinkedWithCurrent = "linked-with-current",
}

export type LoginVaultLinkedIdentity = Pick<
  IdentityDirectoryEntry,
  "identityId" | "label" | "localAccess"
>;

export type LoginVaultIdentityContext =
  | { readonly kind: LoginVaultIdentityContextKind.Loading }
  | { readonly kind: LoginVaultIdentityContextKind.Failed }
  | { readonly kind: LoginVaultIdentityContextKind.Empty }
  | {
      readonly kind: LoginVaultIdentityContextKind.LinkedWithoutCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
    }
  | {
      readonly kind: LoginVaultIdentityContextKind.LinkedWithCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
      readonly currentIdentity: LoginVaultLinkedIdentity;
    };

type LoginVaultIdentityContextRequest = {
  readonly identities: readonly IdentityDirectoryEntry[];
  readonly storeId: string;
};

export function buildLoginVaultIdentityContext(
  request: LoginVaultIdentityContextRequest,
): LoginVaultIdentityContext {
  const { identities, storeId } = request;
  const linkedIdentities = identities
    .filter((identity) =>
      identity.vaults.some((vault) => vault.storeId === storeId),
    )
    .map(({ identityId, label, localAccess }) => ({
      identityId,
      label,
      localAccess,
    }));

  if (linkedIdentities.length === 0) {
    return { kind: LoginVaultIdentityContextKind.Empty };
  }

  const currentIdentity = linkedIdentities.find(
    (identity) =>
      identity.localAccess === NookIdentityLocalAccessKind.CurrentBrowser,
  );
  if (!currentIdentity) {
    return {
      kind: LoginVaultIdentityContextKind.LinkedWithoutCurrent,
      identities: linkedIdentities,
    };
  }

  return {
    kind: LoginVaultIdentityContextKind.LinkedWithCurrent,
    identities: linkedIdentities,
    currentIdentity,
  };
}
