export function prettyJson(value) {
  return JSON.stringify(value, (_key, nestedValue) => nestedValue, 2)
}
