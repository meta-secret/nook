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

/** How prominently the rail shows a page. */
export enum ManageNavTier {
  /** The identity's home: its vaults and where they sync. */
  Home = "home",
  /** Who and what can open the identity. */
  Security = "security",
  /** Browser preferences. */
  General = "general",
}

export type ManageNavItem = {
  readonly section: WorkspaceSection;
  readonly scope: ManageSectionScope;
  readonly tier: ManageNavTier;
  readonly labelKey: string;
  readonly shortLabelKey: string;
  readonly descriptionKey: string;
  readonly testId: string;
  readonly placement: ManageNavPlacement;
};

type ManageNavDefinition = Omit<ManageNavItem, "scope">;

const DEFINITIONS: readonly ManageNavDefinition[] = [
  {
    section: WorkspaceSection.Vaults,
    tier: ManageNavTier.Home,
    labelKey: I18N_KEYS.WorkspaceSectionHome,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortVaults,
    descriptionKey: I18N_KEYS.WorkspaceSectionVaultsDescription,
    testId: "manage-nav-vaults",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Keys,
    tier: ManageNavTier.Security,
    labelKey: I18N_KEYS.WorkspaceSectionKeys,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortKeys,
    descriptionKey: I18N_KEYS.WorkspaceSectionKeysDescription,
    testId: "manage-nav-keys",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Devices,
    tier: ManageNavTier.Security,
    labelKey: I18N_KEYS.WorkspaceSectionDevices,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortDevices,
    descriptionKey: I18N_KEYS.WorkspaceSectionDevicesDescription,
    testId: "manage-nav-devices",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Passwords,
    tier: ManageNavTier.Security,
    labelKey: I18N_KEYS.WorkspaceSectionPasswords,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortPasswords,
    descriptionKey: I18N_KEYS.WorkspaceSectionPasswordsDescription,
    testId: "manage-nav-passwords",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Settings,
    tier: ManageNavTier.General,
    labelKey: I18N_KEYS.WorkspaceSectionSettings,
    shortLabelKey: I18N_KEYS.WorkspaceNavShortSettings,
    descriptionKey: I18N_KEYS.WorkspaceSectionSettingsDescription,
    testId: "manage-nav-settings",
    placement: ManageNavPlacement.Everywhere,
  },
  {
    section: WorkspaceSection.Import,
    tier: ManageNavTier.General,
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

  /** Sync is part of the identity home, not a page of its own. */
  get navSection(): WorkspaceSection {
    return this.section === WorkspaceSection.Sync
      ? WorkspaceSection.Vaults
      : this.section;
  }

  get entry(): ManageNavEntry {
    const section = this.navSection;
    for (const item of MANAGE_NAV_ITEMS) {
      if (item.section === section)
        return { kind: ManageNavEntryKind.Listed, item };
    }
    return { kind: ManageNavEntryKind.Unlisted };
  }
}
