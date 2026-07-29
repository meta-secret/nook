export type ValueState<T> =
  | { kind: "empty" }
  | { kind: "present"; value: T };

export const EMPTY_VALUE: ValueState<never> = { kind: "empty" };

export function presentValue<T>(value: T): ValueState<T> {
  return { kind: "present", value };
}

/** Normalize optional boundary data immediately into explicit application state. */
export function valueState<T>(value: T | void): ValueState<T> {
  return typeof value === "undefined" ? EMPTY_VALUE : presentValue(value);
}

/** Expose an explicit state through an API that must retain optional compatibility. */
export function valueFromState<T>(state: ValueState<T>): T | void {
  if (state.kind === "present") return state.value;
  return;
}

/** Adapt a condition to a structural optional value at an external API boundary. */
export function presentWhen<T>(condition: boolean, value: T): T | void {
  if (condition) return value;
  return;
}

/** Supply an intentionally omitted positional value to an external API. */
export function omittedValue(): void {}
