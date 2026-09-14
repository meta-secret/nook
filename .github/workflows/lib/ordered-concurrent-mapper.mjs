export class OrderedConcurrentMapper {
  /** @param {number} concurrency */
  constructor(concurrency) {
    this.concurrency = concurrency;
  }

  /**
   * @template Input, Output
   * @param {readonly Input[]} items
   * @param {(item: Input, index: number) => Promise<Output>} mapper
   * @returns {Promise<Output[]>}
   */
  async map(items, mapper) {
    /** @type {Output[]} */
    const results = new Array(items.length);
    const entries = items.entries();
    const workerCount = Math.min(this.concurrency, items.length);
    await Promise.all(
      Array.from({ length: workerCount }, () =>
        this.mapEntries(entries, results, mapper),
      ),
    );
    return results;
  }

  /**
   * @template Input, Output
   * @param {ArrayIterator<[number, Input]>} entries
   * @param {Output[]} results
   * @param {(item: Input, index: number) => Promise<Output>} mapper
   * @returns {Promise<void>}
   */
  async mapEntries(entries, results, mapper) {
    for (const [index, item] of entries) {
      results[index] = await mapper(item, index);
    }
  }
}
