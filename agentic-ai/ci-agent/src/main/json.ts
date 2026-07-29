export function prettyJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => nestedValue, 2);
}
