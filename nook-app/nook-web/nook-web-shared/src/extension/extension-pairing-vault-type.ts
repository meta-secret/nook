import { err, ok, type Result } from "neverthrow";
import type { ExtensionPairingVaultType } from "./nook-companion-wasm/nook_companion_wasm.js";

export type ExtensionPairingVaultTypeRuntime = Pick<
  typeof import("./nook-companion-wasm/nook_companion_wasm.js"),
  "admit_extension_pairing_vault_type"
>;

export enum ExtensionPairingVaultTypeAdmissionFailure {
  RuntimeUnavailable = "pairing-vault-type-runtime-unavailable",
  Unsupported = "unsupported-pairing-vault-type",
}

enum ExtensionPairingVaultTypeRuntimeStateKind {
  Unconfigured = "unconfigured",
  Configured = "configured",
}

type ExtensionPairingVaultTypeRuntimeState =
  | { readonly kind: ExtensionPairingVaultTypeRuntimeStateKind.Unconfigured }
  | {
      readonly kind: ExtensionPairingVaultTypeRuntimeStateKind.Configured;
      readonly runtime: ExtensionPairingVaultTypeRuntime;
    };

/** Routes browser wire admission through the generated companion value parser. */
class ExtensionPairingVaultTypeCatalog {
  private runtimeState: ExtensionPairingVaultTypeRuntimeState = {
    kind: ExtensionPairingVaultTypeRuntimeStateKind.Unconfigured,
  };

  configure(runtime: ExtensionPairingVaultTypeRuntime): void {
    this.runtimeState = {
      kind: ExtensionPairingVaultTypeRuntimeStateKind.Configured,
      runtime,
    };
  }

  admit(
    value: string,
  ): Result<
    ExtensionPairingVaultType,
    ExtensionPairingVaultTypeAdmissionFailure
  > {
    switch (this.runtimeState.kind) {
      case ExtensionPairingVaultTypeRuntimeStateKind.Unconfigured:
        return err(
          ExtensionPairingVaultTypeAdmissionFailure.RuntimeUnavailable,
        );
      case ExtensionPairingVaultTypeRuntimeStateKind.Configured:
        try {
          return ok(
            this.runtimeState.runtime.admit_extension_pairing_vault_type(
              value,
            ),
          );
        } catch {
          return err(ExtensionPairingVaultTypeAdmissionFailure.Unsupported);
        }
    }
  }
}

export const extensionPairingVaultType =
  new ExtensionPairingVaultTypeCatalog();
