import type { Component } from "svelte";
import {
  Cloud,
  Fingerprint,
  Laptop,
  KeyRound,
  MonitorSmartphone,
  Vault,
} from "@lucide/svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";

/** How the arrow leading up to a box points. */
export enum FirstRunDiagramArrowKind {
  /** The first box: nothing leads up to it. */
  Start = "start",
  /** The box before leads to this one. */
  Forward = "forward",
  /** This box leads back to the one before, as devices do to their sync
   * provider. */
  Back = "back",
}

/** The arrow leading up to a box, with the word written on it that says what
 * the one box does to the other. */
export type FirstRunDiagramArrow =
  | { readonly kind: FirstRunDiagramArrowKind.Start }
  | { readonly kind: FirstRunDiagramArrowKind.Forward; readonly label: string }
  | { readonly kind: FirstRunDiagramArrowKind.Back; readonly label: string };

/** One box of a setup step's diagram. */
export type FirstRunDiagramNode = {
  readonly icon: Component;
  readonly label: string;
  readonly testId: string;
  /** The box this step is about; it is filled in. */
  readonly current: boolean;
  readonly arrow: FirstRunDiagramArrow;
};

/** A setup step's diagram: its boxes, left to right, and what it shows. */
export type FirstRunDiagramView = {
  readonly label: string;
  readonly testId: string;
  readonly nodes: readonly FirstRunDiagramNode[];
};

export type FirstRunKeyDiagramRequest = {
  readonly vault: VaultState;
  /** The identity the passkey opens: its name, or "Your identity" while it
   * has none. */
  readonly identity: string;
};

/** The passkey, made on this step, opens the identity, which holds the
 * vaults. */
export function firstRunKeyDiagram({
  vault,
  identity,
}: FirstRunKeyDiagramRequest): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.FirstRunDiagramLabel),
    testId: "first-run-key-diagram",
    nodes: [
      {
        icon: Fingerprint,
        label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
        testId: "first-run-diagram-passkey",
        current: true,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icon: KeyRound,
        label: identity || vault.t(I18N_KEYS.FirstRunDiagramIdentity),
        testId: "first-run-diagram-identity",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunDiagramUnlocks),
        },
      },
      {
        icon: Vault,
        label: vault.t(I18N_KEYS.FirstRunDiagramVaults),
        testId: "first-run-diagram-vaults",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunDiagramOpens),
        },
      },
    ],
  };
}

export type FirstRunSyncDiagramRequest = {
  readonly vault: VaultState;
  /** The provider's box: its name, or "Sync provider" before one is chosen. */
  readonly provider: string;
};

/** This device and its other devices each sync with the provider, which is
 * filled in: This device → provider ← other devices. */
export function firstRunSyncDiagram({
  vault,
  provider,
}: FirstRunSyncDiagramRequest): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.FirstRunSyncDiagramLabel),
    testId: "first-run-sync-diagram",
    nodes: [
      {
        icon: MonitorSmartphone,
        label: vault.t(I18N_KEYS.JoinThisDevice),
        testId: "first-run-sync-diagram-here",
        current: false,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icon: Cloud,
        label: provider,
        testId: "first-run-sync-diagram-provider",
        current: true,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunSyncDiagramSyncs),
        },
      },
      {
        icon: Laptop,
        label: vault.t(I18N_KEYS.FirstRunSyncDiagramDevices),
        testId: "first-run-sync-diagram-devices",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Back,
          label: vault.t(I18N_KEYS.FirstRunSyncDiagramSyncs),
        },
      },
    ],
  };
}

/** Recovery: the sync provider, filled in, holds the vaults the passkey
 * opens. */
export function firstRunRecoveryDiagram(
  vault: VaultState,
): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.FirstRunRestoreDiagramLabel),
    testId: "first-run-recovery-diagram",
    nodes: [
      {
        icon: Cloud,
        label: vault.t(I18N_KEYS.JoinNodeProvider),
        testId: "first-run-recovery-diagram-provider",
        current: true,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icon: Fingerprint,
        label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
        testId: "first-run-recovery-diagram-passkey",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunRestoreDiagramRecoverWith),
        },
      },
      {
        icon: Vault,
        label: vault.t(I18N_KEYS.FirstRunDiagramVaults),
        testId: "first-run-recovery-diagram-vaults",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunDiagramOpens),
        },
      },
    ],
  };
}
