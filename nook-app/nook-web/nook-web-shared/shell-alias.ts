/**
 * A relative-base shell names its assets `./assets/…`. A nested alias such as
 * `identity/devices.html` must climb back to the app root, or a reload there
 * asks for `identity/assets/…`.
 */
export function shellForAlias(shell: string, alias: string): string {
  const depth = alias.split("/").length - 1;
  return depth === 0
    ? shell
    : shell.replaceAll('="./', `="${"../".repeat(depth)}`);
}
