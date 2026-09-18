export class SerializedWireValueAdapter {
  private constructor() {}

  static snapshot(value: unknown): string | undefined {
    return JSON.stringify(value)
  }

  static restore<Value>(snapshot: string): Value {
    // The caller must first validate the source value with its concrete decoder.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(snapshot) as Value
  }
}
