/** Longer than one frame, so a rendering opportunity passes while idle. */
const PAINT_DELAY_MS = 20;

/**
 * Vault work runs WASM encryption on the main thread and can hold the page for
 * seconds. Status shown for that work must reach the screen before it starts.
 */
export class PaintOpportunity {
  /** Let the browser paint pending UI before the caller's next step. */
  static async next(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, PAINT_DELAY_MS));
  }
}
