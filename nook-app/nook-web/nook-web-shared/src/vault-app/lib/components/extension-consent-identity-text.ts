export type ExtensionConsentIdentityTextLayout = {
  readonly head: number;
  readonly tail: number;
};

export class ExtensionConsentIdentityText {
  constructor(private readonly value: string) {}

  truncate(layout: ExtensionConsentIdentityTextLayout): string {
    if (this.value.length <= layout.head + layout.tail + 3) return this.value;
    return `${this.value.slice(0, layout.head)}...${this.value.slice(-layout.tail)}`;
  }
}
