import {
  NookSelectedVaultIdentityContextKind,
  type NookIdentitySnapshot,
  type NookVaultManager,
} from "$app-wasm";

export enum LoginVaultIdentityContextKind {
  Loading = "loading",
  Failed = "failed",
}

export type LoginVaultLinkedIdentity = {
  readonly identityId: string;
  readonly label: string;
};

type LoadLoginVaultIdentityContextArgs = {
  readonly manager: NookVaultManager;
  readonly storeId: string;
};

export type LoginVaultIdentityContext =
  | { readonly kind: LoginVaultIdentityContextKind.Loading }
  | { readonly kind: LoginVaultIdentityContextKind.Failed }
  | { readonly kind: NookSelectedVaultIdentityContextKind.Empty }
  | {
      readonly kind: NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
    }
  | {
      readonly kind: NookSelectedVaultIdentityContextKind.LinkedWithCurrent;
      readonly identities: readonly LoginVaultLinkedIdentity[];
      readonly currentIdentity: LoginVaultLinkedIdentity;
    };

export class LoginVaultIdentityReader {
  constructor(private readonly request: LoadLoginVaultIdentityContextArgs) {}
  async execute(): Promise<LoginVaultIdentityContext> {
    const { manager, storeId } = this.request;
    const request = manager.selected_vault_identity_context_request(storeId);
    const snapshot = await request.resolve().finally(() => request.free());
    try {
      const kind = snapshot.selectedVaultContextKind;
      if (kind === NookSelectedVaultIdentityContextKind.Empty) {
        return { kind };
      }

      const identities: LoginVaultLinkedIdentity[] = [];
      for (let index = 0; index < snapshot.length; index += 1) {
        identities.push(
          LoginVaultIdentityReader.readLinkedIdentity(snapshot.identity(index)),
        );
      }

      if (kind === NookSelectedVaultIdentityContextKind.LinkedWithoutCurrent) {
        return { kind, identities };
      }

      return {
        kind,
        identities,
        currentIdentity: LoginVaultIdentityReader.readLinkedIdentity(
          snapshot.current_browser_identity(),
        ),
      };
    } finally {
      snapshot.free();
    }
  }
  static readLinkedIdentity(
    identity: NookIdentitySnapshot,
  ): LoginVaultLinkedIdentity {
    try {
      return {
        identityId: identity.identityId,
        label: identity.label,
      };
    } finally {
      identity.free();
    }
  }
}
