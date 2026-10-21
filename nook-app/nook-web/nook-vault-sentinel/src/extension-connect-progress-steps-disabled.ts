export type { ExtensionConnectPageView } from "../../nook-web-shared/src/vault-app/lib/components/extension-connect-progress-steps";
import type { ExtensionConnectPageView } from "../../nook-web-shared/src/vault-app/lib/components/extension-connect-progress-steps";

export enum ExtensionConnectPageReportKind {
  Silent = "silent",
  /** @public Kept for the shell's exhaustive match; Sentinel never reports. */
  Report = "report",
}

export type ExtensionConnectPageReport =
  | { readonly kind: ExtensionConnectPageReportKind.Silent }
  | {
      readonly kind: ExtensionConnectPageReportKind.Report;
      readonly step: never;
    };

/** Sentinel has no connect route, so its shell never reports a step. */
export class ExtensionConnectPageSteps {
  private constructor() {}

  static page(view: ExtensionConnectPageView): ExtensionConnectPageReport {
    void view;
    return { kind: ExtensionConnectPageReportKind.Silent };
  }
}
