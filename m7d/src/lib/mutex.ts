/**
 * Minimal async mutex: `run()` executes tasks one at a time, in call order.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `task` after every previously queued task has settled. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // Keep the chain alive even if a task fails; the caller still sees the rejection.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
