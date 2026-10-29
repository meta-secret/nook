import type { Component } from "svelte";
import { Fingerprint, UserRound, Vault } from "@lucide/svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";

/** One box of a setup step's diagram. */
export type FirstRunDiagramNode = {
  readonly icon: Component;
  readonly label: string;
  readonly testId: string;
  /** The box this step is about; it is filled in. */
  readonly current: boolean;
};

/** A setup step's diagram: its boxes, left to right, and what it shows. */
export type FirstRunDiagramView = {
  readonly label: string;
  readonly testId: string;
  readonly nodes: readonly FirstRunDiagramNode[];
};

/** The box of the key diagram a setup step is about. */
export enum FirstRunKeyStep {
  Passkey = "passkey",
  Identity = "identity",
  Vaults = "vaults",
}

export type FirstRunKeyDiagramRequest = {
  readonly vault: VaultState;
  readonly current: FirstRunKeyStep;
};

/** The passkey opens the identity, which holds the vaults; the box the
 * step is about is filled in. */
export function firstRunKeyDiagram({
  vault,
  current,
}: FirstRunKeyDiagramRequest): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.FirstRunDiagramLabel),
    testId: "first-run-key-diagram",
    nodes: [
      {
        icon: Fingerprint,
        label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
        testId: "first-run-diagram-passkey",
        current: current === FirstRunKeyStep.Passkey,
      },
      {
        icon: UserRound,
        label: vault.t(I18N_KEYS.FirstRunDiagramIdentity),
        testId: "first-run-diagram-identity",
        current: current === FirstRunKeyStep.Identity,
      },
      {
        icon: Vault,
        label: vault.t(I18N_KEYS.FirstRunDiagramVaults),
        testId: "first-run-diagram-vaults",
        current: current === FirstRunKeyStep.Vaults,
      },
    ],
  };
}
