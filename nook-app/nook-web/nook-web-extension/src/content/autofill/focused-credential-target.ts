export enum FocusedCredentialTargetKind {
  Empty = 'empty',
  Retained = 'retained',
}

export type FocusedCredentialTarget =
  | { readonly kind: FocusedCredentialTargetKind.Empty }
  | {
      readonly kind: FocusedCredentialTargetKind.Retained
      readonly input: HTMLInputElement
      readonly origin: string
    }

export enum FocusedCredentialTargetValidity {
  Current = 'current',
  Changed = 'changed',
}
export enum FocusedCredentialTargetRetention {
  Retained = 'retained',
  Released = 'released',
}

export type RetainedFocusedCredentialTarget = Extract<
  FocusedCredentialTarget,
  { kind: FocusedCredentialTargetKind.Retained }
>

type FocusedCredentialTargetDependencies = {
  readonly document: Document
  readonly schedule: () => void
}

/** Retains the interacted DOM field while focus moves into Nook's chooser. */
export class FocusedCredentialTargetSensor {
  private retained: FocusedCredentialTarget = {
    kind: FocusedCredentialTargetKind.Empty,
  }

  constructor(
    private readonly dependencies: FocusedCredentialTargetDependencies,
  ) {}

  get target(): FocusedCredentialTarget {
    return this.retained
  }

  observe(event: Event): void {
    const input = event.target
    switch (true) {
      case input instanceof HTMLInputElement:
        this.retained = {
          kind: FocusedCredentialTargetKind.Retained,
          input,
          origin: location.origin,
        }
        this.dependencies.schedule()
        return
      case true:
        return
    }
  }

  validity(
    target: RetainedFocusedCredentialTarget,
  ): FocusedCredentialTargetValidity {
    switch (
      target.input.isConnected &&
      target.input.ownerDocument === this.dependencies.document &&
      target.origin === location.origin &&
      !target.input.disabled &&
      !target.input.readOnly
    ) {
      case false:
        return FocusedCredentialTargetValidity.Changed
      case true:
        return FocusedCredentialTargetValidity.Current
    }
  }

  retains(
    target: RetainedFocusedCredentialTarget,
  ): FocusedCredentialTargetRetention {
    switch (this.retained.kind) {
      case FocusedCredentialTargetKind.Empty:
        return FocusedCredentialTargetRetention.Released
      case FocusedCredentialTargetKind.Retained:
        switch (
          this.retained.input === target.input &&
          this.retained.origin === target.origin
        ) {
          case true:
            return FocusedCredentialTargetRetention.Retained
          case false:
            return FocusedCredentialTargetRetention.Released
        }
    }
  }

  clear(): void {
    this.retained = { kind: FocusedCredentialTargetKind.Empty }
  }
}
