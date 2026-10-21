import { Schema } from "effect";

/**
 * The vault page asks the browser extension to show its side panel in the
 * page's window, over the vault-to-extension messaging channel. A signal
 * only: it carries no vault data and grants nothing; the panel keeps its
 * own lock.
 */
export enum ExtensionSidePanelSignalType {
  NookOpenSidePanel = "nook:open-side-panel",
}

export type ExtensionSidePanelSignal = {
  readonly type: ExtensionSidePanelSignalType.NookOpenSidePanel;
};

type ExtensionSidePanelSignalFields = {
  type: Schema.Literal<ExtensionSidePanelSignalType.NookOpenSidePanel>;
};
const extensionSidePanelSignalFields: ExtensionSidePanelSignalFields = {
  type: Schema.Literal(ExtensionSidePanelSignalType.NookOpenSidePanel),
};

export const ExtensionSidePanelSignalSchema = Schema.Struct(
  extensionSidePanelSignalFields,
) satisfies Schema.Codec<ExtensionSidePanelSignal>;
