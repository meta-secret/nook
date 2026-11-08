import type { Component } from "svelte";
import {
  Fingerprint,
  Laptop,
  KeyRound,
  MonitorSmartphone,
  Vault,
} from "@lucide/svelte";
import { I18N_KEYS } from "../../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import GoogleDriveMark from "../provider-marks/GoogleDriveMark.svelte";
import ICloudMark from "../provider-marks/ICloudMark.svelte";

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

/** An icon or service mark the diagram sizes. */
export type FirstRunDiagramIcon = Component<{ class: string }>;

/** One box of a setup step's diagram. */
export type FirstRunDiagramNode = {
  /** What the box shows: one icon, or the marks of the services it stands
   * for, side by side. */
  readonly icons: readonly [FirstRunDiagramIcon, ...FirstRunDiagramIcon[]];
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
        icons: [Fingerprint],
        label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
        testId: "first-run-diagram-passkey",
        current: true,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icons: [KeyRound],
        label: identity || vault.t(I18N_KEYS.FirstRunDiagramIdentity),
        testId: "first-run-diagram-identity",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunDiagramUnlocks),
        },
      },
      {
        icons: [Vault],
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

/** Which sync provider the diagram's provider box stands for. */
export enum FirstRunSyncDiagramProvider {
  /** None is chosen yet: the box is captioned "Your cloud storage" and drawn
   * with the marks of the services it can be. */
  Any = "any",
  GoogleDrive = "google-drive",
  ICloud = "icloud",
}

type ProviderBox = Pick<FirstRunDiagramNode, "icons" | "label">;

function providerBox(
  vault: VaultState,
  provider: FirstRunSyncDiagramProvider,
): ProviderBox {
  switch (provider) {
    case FirstRunSyncDiagramProvider.Any:
      return {
        icons: [GoogleDriveMark, ICloudMark],
        label: vault.t(I18N_KEYS.FirstRunSyncDiagramCloud),
      };
    case FirstRunSyncDiagramProvider.GoogleDrive:
      return {
        icons: [GoogleDriveMark],
        label: vault.t(I18N_KEYS.ProviderPickerGoogleDrive),
      };
    case FirstRunSyncDiagramProvider.ICloud:
      return {
        icons: [ICloudMark],
        label: vault.t(I18N_KEYS.ProviderPickerIcloud),
      };
  }
}

export type FirstRunSyncDiagramRequest = {
  readonly vault: VaultState;
  readonly provider: FirstRunSyncDiagramProvider;
};

/** This device and its other devices each sync with the provider, which is
 * filled in: This device → provider ← other devices. */
export function firstRunSyncDiagram({
  vault,
  provider,
}: FirstRunSyncDiagramRequest): FirstRunDiagramView {
  const box = providerBox(vault, provider);
  return {
    label: vault.t(I18N_KEYS.FirstRunSyncDiagramLabel),
    testId: "first-run-sync-diagram",
    nodes: [
      {
        icons: [MonitorSmartphone],
        label: vault.t(I18N_KEYS.JoinThisDevice),
        testId: "first-run-sync-diagram-here",
        current: false,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icons: box.icons,
        label: box.label,
        testId: "first-run-sync-diagram-provider",
        current: true,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunSyncDiagramSyncs),
        },
      },
      {
        icons: [Laptop],
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

/** Recovery: the sync provider, filled in, keeps the keyring, and the
 * keyring's passkey unlocks it. Providers keep keyrings, not vaults: the
 * vaults come with the keyring. */
export function firstRunRecoveryDiagram(
  vault: VaultState,
): FirstRunDiagramView {
  return {
    label: vault.t(I18N_KEYS.FirstRunRestoreDiagramLabel),
    testId: "first-run-recovery-diagram",
    nodes: [
      {
        ...providerBox(vault, FirstRunSyncDiagramProvider.Any),
        testId: "first-run-recovery-diagram-provider",
        current: true,
        arrow: { kind: FirstRunDiagramArrowKind.Start },
      },
      {
        icons: [KeyRound],
        label: vault.t(I18N_KEYS.FirstRunDiagramIdentity),
        testId: "first-run-recovery-diagram-keyring",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Forward,
          label: vault.t(I18N_KEYS.FirstRunRestoreDiagramKeeps),
        },
      },
      {
        icons: [Fingerprint],
        label: vault.t(I18N_KEYS.FirstRunDiagramPasskey),
        testId: "first-run-recovery-diagram-passkey",
        current: false,
        arrow: {
          kind: FirstRunDiagramArrowKind.Back,
          label: vault.t(I18N_KEYS.FirstRunDiagramUnlocks),
        },
      },
    ],
  };
}
