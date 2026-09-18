export class SerializedWireValueAdapter {
  private constructor() {}

  static snapshotEventLogRecords(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined
    if ('eventLogRecords' in value) {
      return JSON.stringify(value.eventLogRecords)
    }
    if (!('payload' in value)) return undefined
    const payload = value.payload
    if (!payload || typeof payload !== 'object') return undefined
    if (!('eventLogRecords' in payload)) return undefined
    return JSON.stringify(payload.eventLogRecords)
  }

  static restoreEventLogRecords<Value>(snapshot: string): Value {
    // The caller must first validate the source value with its concrete decoder.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(snapshot) as Value
  }
}
