/** Adapt a condition to a structural optional value at an external API boundary. */
export function presentWhen<T>(condition: boolean, value: T): T | void {
  if (condition) return value;
  return;
}

/** Supply an intentionally omitted positional value to an external API. */
export function omittedValue(): void {}
