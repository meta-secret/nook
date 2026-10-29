import { KeyRound, Puzzle, Vault } from "@lucide/svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import {
  FirstRunDiagramArrow,
  type FirstRunDiagramView,
} from "./login/first-run-diagram";

export type ExtensionConnectDiagramRequest = {
  readonly vault: VaultState;
  /** The keyring the extension joins, by name. */
  readonly keyring: string;
};

/** The extension, filled in, joins the keyring as an app of its own and
 * through it opens every vault: Extension → keyring → all its vaults. */
export function extensionConnectDiagram({
  vault,
  keyring,
}: ExtensionConnectDiagramRequest): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.ExtensionConsentDiagramLabel),
    testId: "extension-connect-diagram",
    nodes: [
      {
        icon: Puzzle,
        label: vault.t(I18N_KEYS.ExtensionConsentDiagramExtension),
        testId: "extension-connect-diagram-extension",
        current: true,
        arrow: FirstRunDiagramArrow.Forward,
      },
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
    ],
  };
}
