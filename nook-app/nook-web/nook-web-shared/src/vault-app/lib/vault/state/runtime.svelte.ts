import {
  get_translation_catalog,
  NookBrowserLocale,
  NookClientRunModeUtil,
  NookRuntimeConfig,
  NookVaultClientPolicy,
  type NookAppLocale,
} from "$app-wasm";

type ScheduledSyncInvalidationAlertOwnership =
  | { readonly kind: "unowned" }
  | {
      readonly kind: "owned";
      readonly sessionEpoch: number;
      readonly errorMsgRevision: number;
      readonly message: string;
    };

type ScheduledSyncInvalidationAlertRecord = {
  readonly sessionEpoch: number;
  readonly message: string;
};

type ScheduledSyncInvalidationAlertClearance = {
  readonly sessionEpoch: number;
  readonly errorMsgRevision: number;
};

export class VaultRuntimeState {
  browserLocale: NookBrowserLocale;
  clientPolicy = new NookVaultClientPolicy();
  runtimeConfig = new NookRuntimeConfig(
    NookClientRunModeUtil.parse(
      ((...[v = import.meta.env.MODE]) => v)(
        import.meta.env.VITE_NOOK_CLIENT_RUN_MODE,
      ),
    ),
    import.meta.env.VITE_E2E_EXPOSE_VAULT === "true",
  );

  locale = $state<NookAppLocale>("en");
  translations = $state(get_translation_catalog("en"));

  private errorMessageState = $state("");
  private errorMessageRevisionState = $state(0);
  private scheduledSyncInvalidationAlertOwnershipState =
    $state<ScheduledSyncInvalidationAlertOwnership>({ kind: "unowned" });
  get errorMsg(): string {
    return this.errorMessageState;
  }
  get errorMsgRevision(): number {
    return this.errorMessageRevisionState;
  }
  set errorMsg(value: string) {
    this.errorMessageState = value;
    this.errorMessageRevisionState += 1;
    this.scheduledSyncInvalidationAlertOwnershipState = {
      kind: "unowned",
    };
  }

  recordScheduledSyncInvalidationAlert({
    sessionEpoch,
    message,
  }: ScheduledSyncInvalidationAlertRecord): void {
    if (this.errorMessageState !== message) return;
    this.scheduledSyncInvalidationAlertOwnershipState = {
      kind: "owned",
      sessionEpoch,
      errorMsgRevision: this.errorMessageRevisionState,
      message,
    };
  }

  clearScheduledSyncInvalidationAlert({
    sessionEpoch,
    errorMsgRevision,
  }: ScheduledSyncInvalidationAlertClearance): void {
    const ownership = this.scheduledSyncInvalidationAlertOwnershipState;
    if (
      ownership.kind !== "owned" ||
      ownership.sessionEpoch !== sessionEpoch ||
      ownership.errorMsgRevision !== errorMsgRevision ||
      ownership.errorMsgRevision !== this.errorMessageRevisionState ||
      ownership.message !== this.errorMessageState
    )
      return;
    this.errorMsg = "";
  }

  successMsg = $state("");
  isVerifying = $state(false);
  isSaving = $state(false);
  isInitializing = $state(true);

  constructor(browserLocale: NookBrowserLocale) {
    this.browserLocale = browserLocale;
  }
}
