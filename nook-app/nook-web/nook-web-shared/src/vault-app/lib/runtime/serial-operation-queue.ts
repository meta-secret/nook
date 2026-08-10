export class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = completionOf(result);
    return result;
  }

  onIdle(): Promise<void> {
    return this.tail;
  }

  reset(): void {
    this.tail = Promise.resolve();
  }
}

async function completionOf<Result>(operation: Promise<Result>): Promise<void> {
  try {
    await operation;
  } catch {
    // The operation promise still rejects for its caller. The queue tail only
    // represents completion, so one failed operation cannot block later work.
  }
}
