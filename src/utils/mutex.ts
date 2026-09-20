/**
 * A keyed in-memory async mutex that serializes asynchronous executions on a per-key basis.
 *
 * Concurrency Architecture:
 * - Designed for single-process bot deployments (such as Snipsik's single-replica Discord Gateway architecture)
 *   to serialize concurrent read-modify-write mutations per guild/user within the Node/Bun runtime without
 *   relying on PostgreSQL's FOR UPDATE row-level locks.
 * - Service layers combine this KeyedMutex with database-level Optimistic Concurrency Control (OCC)
 *   on `updatedAt` to ensure safe operation even across multiple processes or deploy overlaps.
 */
export class KeyedMutex {
  private queues: Map<string, Promise<unknown>> = new Map();

  /**
   * Executes an asynchronous task exclusively for the given key.
   * Concurrent calls with the same key are executed sequentially in FIFO order.
   *
   * @param key - The unique identifier to lock (e.g., guildId, userId).
   * @param task - The async callback function to execute.
   * @returns The result of the task callback.
   */
  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(key) ?? Promise.resolve();

    let resolveNext!: () => void;
    const nextQueue = new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    // Chain the next task to the queue for this key
    this.queues.set(key, nextQueue);

    try {
      // Wait for any previous task on this key to finish (whether resolved or rejected)
      await currentQueue.catch(() => {});
      return await task();
    } finally {
      // Release next task in queue
      resolveNext();

      // Clean up map entry if this was the last chained task
      if (this.queues.get(key) === nextQueue) {
        this.queues.delete(key);
      }
    }
  }

  /**
   * Returns the current number of active keys in the mutex.
   */
  get size(): number {
    return this.queues.size;
  }
}

export const keyedMutex = new KeyedMutex();
