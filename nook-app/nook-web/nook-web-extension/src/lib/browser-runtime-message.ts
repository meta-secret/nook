export enum BrowserRuntimeMessageAdmissionKind {
  Accepted = 'accepted',
  Rejected = 'rejected',
}

export type BrowserRuntimeMessageAdmission =
  | {
      readonly kind: BrowserRuntimeMessageAdmissionKind.Accepted
      readonly message: BrowserRuntimeMessage
    }
  | { readonly kind: BrowserRuntimeMessageAdmissionKind.Rejected }

/** Concrete browser IPC envelope admitted before schema-specific routing. */
export class BrowserRuntimeMessage {
  private constructor() {}

  declare readonly type: string

  static from(value: unknown): BrowserRuntimeMessageAdmission {
    if (!BrowserRuntimeMessage.hasMessageType(value)) {
      return { kind: BrowserRuntimeMessageAdmissionKind.Rejected }
    }
    return {
      kind: BrowserRuntimeMessageAdmissionKind.Accepted,
      message: value,
    }
  }

  private static hasMessageType(
    value: unknown,
  ): value is BrowserRuntimeMessage {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'type' in value &&
      typeof value.type === 'string' &&
      value.type.length > 0,
    )
  }
}
