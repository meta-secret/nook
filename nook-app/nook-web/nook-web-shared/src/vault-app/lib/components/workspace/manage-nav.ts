import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  ManageSectionScope,
  WorkspaceSection,
  WorkspaceSectionScope,
} from "$lib/vault/state/ui.svelte";

export enum ManageNavPlacement {
  /** Shown in the desktop rail and the phone bottom bar. */
  Everywhere = "everywhere",
  /** Desktop rail only; phones reach it from the vault page bar. */
  RailOnly = "rail-only",
}

export type ManageNavItem = {
  readonly section: WorkspaceSection;
  readonly scope: ManageSectionScope;
  readonly labelKey: string;
  readonly shortLabelKey: string;
  readonly descriptionKey: string;
  readonly testId: string;
  readonly placement: ManageNavPlacement;
};

type ManageNavDefinition = Omit<ManageNavItem, "scope">;

const DEFINITIONS: readonly ManageNavDefinition[] = [
  {
    section: WorkspaceSection.Keys,
    labelKey: I18N_KEYS.WorkspaceSectionKeys,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortKeys,
    descriptionKey: I18N_KEYS.WorkspaceSectionKeysDescription,
    testId: "manage-nav-keys",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Vaults,
    labelKey: I18N_KEYS.WorkspaceSectionVaults,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortVaults,
    descriptionKey: I18N_KEYS.WorkspaceSectionVaultsDescription,
    testId: "manage-nav-vaults",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Settings,
    labelKey: I18N_KEYS.WorkspaceSectionSettings,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortSettings,
    descriptionKey: I18N_KEYS.WorkspaceSectionSettingsDescription,
    testId: "manage-nav-settings",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Devices,
    labelKey: I18N_KEYS.WorkspaceSectionDevices,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortDevices,
    descriptionKey: I18N_KEYS.WorkspaceSectionDevicesDescription,
    testId: "manage-nav-devices",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Sync,
    labelKey: I18N_KEYS.WorkspaceSectionSync,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortSync,
    descriptionKey: I18N_KEYS.WorkspaceSectionSyncDescription,
    testId: "manage-nav-sync",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Passwords,
    labelKey: I18N_KEYS.WorkspaceSectionPasswords,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortPasswords,
    descriptionKey: I18N_KEYS.WorkspaceSectionPasswordsDescription,
    testId: "manage-nav-passwords",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Import,
    labelKey: I18N_KEYS.WorkspaceSectionImport,
    shortLabelKey: I18N_KEYS.WorkspaceSectionImport,
    descriptionKey: I18N_KEYS.WorkspaceSectionImportDescription,
    testId: "manage-nav-import",
    placement: ManageNavPlacement.Everywhere,
  },
];

/** The management pages, grouped by what they act on. */
export const MANAGE_NAV_ITEMS: readonly ManageNavItem[] = DEFINITIONS.map(
  (definition) => {
    const item: ManageNavItem = {
      ...definition,
      scope: new WorkspaceSectionScope(definition.section).scope,
    };
    return item;
  },
);

export enum ManageNavEntryKind {
  /** A management page with its own navigation entry. */
  Listed = "listed",
  /** The vault page or the identities hub, which are not management pages. */
  Unlisted = "unlisted",
}

export type ManageNavEntry =
  | { readonly kind: ManageNavEntryKind.Listed; readonly item: ManageNavItem }
  | { readonly kind: ManageNavEntryKind.Unlisted };

/** Look up the nav entry (title, description) for a management section. */
export class ManageNavLookup {
  constructor(private readonly section: WorkspaceSection) {}

  get entry(): ManageNavEntry {
    for (const item of MANAGE_NAV_ITEMS) {
      if (item.section === this.section)
        return { kind: ManageNavEntryKind.Listed, item };
    }
    return { kind: ManageNavEntryKind.Unlisted };
  }
}
