import { PanelLeft, Settings } from "@lucide/svelte";
import { I18N_KEYS as K } from "../../../generated/i18n-keys";
export enum WorkspacePage {
  Items = "items",
  Settings = "settings",
}
export const workspaceNavigation = [
  { page: WorkspacePage.Items, label: K.WorkspaceItems, icon: PanelLeft },
  { page: WorkspacePage.Settings, label: K.NavSettings, icon: Settings },
];
