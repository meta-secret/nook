type DeviceIdLabelRequest = {
  readonly value: string;
  /** Characters kept from the start. */
  readonly head: number;
  /** Characters kept from the end. */
  readonly tail: number;
};

/** A long app id shortened for display, keeping both ends readable. */
export class DeviceIdLabel {
  constructor(private readonly request: DeviceIdLabelRequest) {}

  get text(): string {
    const { value, head, tail } = this.request;
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  }
}
