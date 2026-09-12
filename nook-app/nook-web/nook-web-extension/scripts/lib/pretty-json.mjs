/** @typedef {{ fields: Array<Record<string, string>>, submit: Record<string, string> }} LoginFixtureStep */
/** @typedef {{ id?: string, name?: string, family?: string, loginUrl?: string, hosts?: string[], rank?: number, quirks?: string[], steps?: LoginFixtureStep[], template?: string, source?: string }} LoginFixtureJson */

/** @param {LoginFixtureJson | LoginFixtureJson[] | Record<string, LoginFixtureJson>} value */
export function prettyJson(value) {
  return JSON.stringify(value, (_key, nestedValue) => nestedValue, 2)
}
