export enum ProviderAddReturnKind {
  /** Adding a provider from the Sync page itself: stay there. */
  Stay = "stay",
  /** Adding a provider opened from another page: go back to it once the
   * provider is added. */
  Back = "back",
}

/** Where adding a sync provider returns once it adds one. */
export type ProviderAddReturn =
  | { readonly kind: ProviderAddReturnKind.Stay }
  | {
      readonly kind: ProviderAddReturnKind.Back;
      /** The providers before the flow, so an added one shows. */
      readonly providersBefore: number;
    };

/** The return and what the app holds now. */
export type ProviderAddProgress = {
  readonly pending: ProviderAddReturn;
  readonly addOpen: boolean;
  readonly providers: number;
};

export enum ProviderAddStep {
  /** Nothing to do: no return is pending, or the flow is still open. */
  Wait = "wait",
  /** The flow closed with a new provider: go back. */
  ReturnBack = "return-back",
  /** The flow closed without one: stay, and drop the return. */
  Drop = "drop",
}

export class ProviderAddReturns {
  static readonly STAY: ProviderAddReturn = {
    kind: ProviderAddReturnKind.Stay,
  };

  static back(providersBefore: number): ProviderAddReturn {
    return { kind: ProviderAddReturnKind.Back, providersBefore };
  }

  static step({
    pending,
    addOpen,
    providers,
  }: ProviderAddProgress): ProviderAddStep {
    switch (pending.kind) {
      case ProviderAddReturnKind.Stay:
        return ProviderAddStep.Wait;
      case ProviderAddReturnKind.Back:
        if (addOpen) return ProviderAddStep.Wait;
        return providers > pending.providersBefore
          ? ProviderAddStep.ReturnBack
          : ProviderAddStep.Drop;
    }
  }
}
