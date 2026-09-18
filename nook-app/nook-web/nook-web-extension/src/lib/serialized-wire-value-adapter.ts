export enum SerializedWireSnapshotKind {
  Available = 'available',
  Missing = 'missing',
}

export type SerializedWireSnapshot =
  | {
      readonly kind: SerializedWireSnapshotKind.Available
      readonly value: string
    }
  | { readonly kind: SerializedWireSnapshotKind.Missing }

export class SerializedWireValueAdapter {
  private constructor() {}

  static snapshotEventLogRecords(value: unknown): SerializedWireSnapshot {
    if (!value || typeof value !== 'object') {
      return { kind: SerializedWireSnapshotKind.Missing }
    }
    if ('eventLogRecords' in value) {
      const snapshot = JSON.stringify(value.eventLogRecords)
      return typeof snapshot === 'string'
        ? { kind: SerializedWireSnapshotKind.Available, value: snapshot }
        : { kind: SerializedWireSnapshotKind.Missing }
    }
    if (!('payload' in value)) {
      return { kind: SerializedWireSnapshotKind.Missing }
    }
    const payload = value.payload
    if (!payload || typeof payload !== 'object') {
      return { kind: SerializedWireSnapshotKind.Missing }
    }
    if (!('eventLogRecords' in payload)) {
      return { kind: SerializedWireSnapshotKind.Missing }
    }
    const snapshot = JSON.stringify(payload.eventLogRecords)
    return typeof snapshot === 'string'
      ? { kind: SerializedWireSnapshotKind.Available, value: snapshot }
      : { kind: SerializedWireSnapshotKind.Missing }
  }

  static restoreEventLogRecords<Value>(snapshot: string): Value {
    // The caller must first validate the source value with its concrete decoder.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(snapshot) as Value
  }
}
