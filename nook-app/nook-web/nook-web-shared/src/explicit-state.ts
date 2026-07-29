export type ValueState<T> =
  | { kind: "empty" }
  | { kind: "present"; value: T };

export const EMPTY_VALUE: ValueState<never> = { kind: "empty" };

export function presentValue<T>(value: T): ValueState<T> {
  return { kind: "present", value };
}

/** Normalize optional boundary data immediately into explicit application state. */
export function valueState<T>(value: T | undefined): ValueState<T> {
  return value === undefined ? EMPTY_VALUE : presentValue(value);
}

/** Expose an explicit state through an API that must retain optional compatibility. */
export function valueFromState<T>(state: ValueState<T>): T | undefined {
  return state.kind === "present" ? state.value : undefined;
}
