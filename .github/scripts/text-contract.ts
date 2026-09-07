interface TextContractSource {
  label: string;
  source: string;
}

export class TextContract {
  constructor(private readonly input: TextContractSource) {}

  require(fragment: string): void {
    if (!this.input.source.includes(fragment)) {
      throw new Error(
        `${this.input.label} is missing required contract: ${fragment}`,
      );
    }
  }

  requireAll(fragments: string[]): void {
    for (const fragment of fragments) this.require(fragment);
  }

  forbid(fragment: string): void {
    if (this.input.source.includes(fragment)) {
      throw new Error(
        `${this.input.label} contains prohibited contract: ${fragment}`,
      );
    }
  }

  forbidAll(fragments: string[]): void {
    for (const fragment of fragments) this.forbid(fragment);
  }

  count(input: { fragment: string; expected: number }): void {
    const actual = this.input.source.split(input.fragment).length - 1;
    if (actual !== input.expected) {
      throw new Error(
        `${this.input.label} expected ${input.expected} copies of ${input.fragment}, found ${actual}`,
      );
    }
  }

  requireBefore(input: { first: string; second: string }): void {
    const firstIndex = this.input.source.indexOf(input.first);
    const secondIndex = this.input.source.indexOf(input.second);
    if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
      throw new Error(
        `${this.input.label} must place ${input.first} before ${input.second}`,
      );
    }
  }
}
