import { I18N_KEYS } from "../../../../generated/i18n-keys";
import {
  ManageSectionScope,
  WorkspaceSection,
  WorkspaceSectionScope,
} from "$lib/vault/state/ui.svelte";

export type ManageNavItem = {
  readonly section: WorkspaceSection;
  readonly scope: ManageSectionScope;
  readonly labelKey: string;
  readonly descriptionKey: string;
};

type ManageNavDefinition = Omit<ManageNavItem, "scope">;

const DEFINITIONS: readonly ManageNavDefinition[] = [
  {
    section: WorkspaceSection.Overview,
    labelKey: I18N_KEYS.WorkspaceSectionOverview,
    descriptionKey: I18N_KEYS.WorkspaceSectionOverviewDescription,
  },
  {
    section: WorkspaceSection.Vaults,
    labelKey: I18N_KEYS.WorkspaceSectionVaults,
    descriptionKey: I18N_KEYS.WorkspaceSectionVaultsDescription,
  },
  {
    section: WorkspaceSection.Sync,
    labelKey: I18N_KEYS.WorkspaceSectionSync,
    descriptionKey: I18N_KEYS.WorkspaceSectionSyncDescription,
  },
  {
    section: WorkspaceSection.Devices,
    labelKey: I18N_KEYS.WorkspaceSectionDevices,
    descriptionKey: I18N_KEYS.WorkspaceSectionDevicesDescription,
  },
  {
    section: WorkspaceSection.Keys,
    labelKey: I18N_KEYS.WorkspaceSectionKeys,
    descriptionKey: I18N_KEYS.WorkspaceSectionKeysDescription,
  },
  {
    section: WorkspaceSection.Passwords,
    labelKey: I18N_KEYS.WorkspaceSectionPasswords,
    descriptionKey: I18N_KEYS.WorkspaceSectionPasswordsDescription,
  },
  {
    section: WorkspaceSection.Settings,
    labelKey: I18N_KEYS.WorkspaceSectionSettings,
    descriptionKey: I18N_KEYS.WorkspaceSectionSettingsDescription,
  },
  {
    section: WorkspaceSection.Import,
    labelKey: I18N_KEYS.WorkspaceSectionImport,
    descriptionKey: I18N_KEYS.WorkspaceSectionImportDescription,
  },
];

/** The management pages with their titles and descriptions. */
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
