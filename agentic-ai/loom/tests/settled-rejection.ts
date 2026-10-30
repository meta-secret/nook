/**
 * Owns rejection assertions for compiler-backed analyses.
 *
 * Bun's `expect(promise).rejects` waits on a pending promise in coarse polling
 * steps (about 650 ms each), and every TypeScript 7 analysis is pending on its
 * compiler child process. Settling the promise first keeps those assertions
 * as fast as the analysis itself.
 */
export class SettledRejection {
  private constructor() {}

  /** The rejection's message, or `false` when the promise resolved. */
  static async message<T>(pending: Promise<T>): Promise<string | false> {
    try {
      await pending;
      return false;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
