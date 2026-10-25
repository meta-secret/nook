/**
 * Vault work runs WASM encryption on the main thread and can hold the page for
 * seconds. Status shown for that work must reach the screen before it starts.
 */
export class PaintOpportunity {
  /**
   * Hand the event loop back once, so a due frame paints pending UI before
   * the caller's next step. A message task, not a timer: it is not throttled
   * in background tabs and fake clocks in tests do not hold it.
   */
  static async next(): Promise<void> {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  }
}
