/** @typedef {{ fields: Array<Record<string, string>>, submit: Record<string, string> }} LoginFixtureStep */
/** @typedef {{ id?: string, name?: string, family?: string, loginUrl?: string, hosts?: string[], rank?: number, quirks?: string[], steps?: LoginFixtureStep[], template?: string, source?: string }} LoginFixtureJson */

/** @param {LoginFixtureJson | LoginFixtureJson[] | Record<string, LoginFixtureJson>} value */
export function prettyJson(value) {
  /** @param {string} _key @param {unknown} nestedValue @returns {unknown} */
  const replacer = (_key, nestedValue) => nestedValue
  return JSON.stringify(value, replacer, 2)
}
