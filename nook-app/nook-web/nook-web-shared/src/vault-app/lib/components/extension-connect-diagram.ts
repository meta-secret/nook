import { KeyRound, Puzzle, Vault } from "@lucide/svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  FirstRunDiagramArrow,
  type FirstRunDiagramNode,
  type FirstRunDiagramView,
} from "./login/first-run-diagram";

/** How far a connecting extension reaches. */
export enum ExtensionConnectReach {
  /** It joins the keyring, so it opens every vault in it. */
  Keyring = "keyring",
  /** The keyring has no cloud sync provider: only this vault connects. */
  ThisVault = "this-vault",
}

export type ExtensionConnectDiagramRequest = {
  readonly vault: VaultState;
  /** The keyring the extension joins, by name. */
  readonly keyring: string;
  readonly reach: ExtensionConnectReach;
};

/** The extension, filled in, joins the keyring and through it every vault:
 * Extension → keyring → all its vaults, or Extension → this vault. */
export function extensionConnectDiagram({
  vault,
  keyring,
  reach,
}: ExtensionConnectDiagramRequest): FirstRunDiagramView {
  const extension: FirstRunDiagramNode = {
    icon: Puzzle,
    label: vault.t(I18N_KEYS.ExtensionConsentDiagramExtension),
    testId: "extension-connect-diagram-extension",
    current: true,
    arrow: FirstRunDiagramArrow.Forward,
  };
  const nodes: readonly FirstRunDiagramNode[] =
    reach === ExtensionConnectReach.ThisVault
      ? [
          extension,
          {
            icon: Vault,
            label: vault.t(I18N_KEYS.ExtensionConsentDiagramThisVault),
            testId: "extension-connect-diagram-vault",
            current: false,
            arrow: FirstRunDiagramArrow.Forward,
          },
        ]
      : [
          extension,
          {
            icon: KeyRound,
            label: keyring,
            testId: "extension-connect-diagram-keyring",
            current: false,
            arrow: FirstRunDiagramArrow.Forward,
          },
          {
            icon: Vault,
            label: vault.t(I18N_KEYS.ExtensionConsentDiagramVaults),
            testId: "extension-connect-diagram-vaults",
            current: false,
            arrow: FirstRunDiagramArrow.Forward,
          },
        ];
  return {
    label: vault.t(I18N_KEYS.ExtensionConsentDiagramLabel),
    testId: "extension-connect-diagram",
    nodes,
  };
}
