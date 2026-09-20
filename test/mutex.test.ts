import { describe, expect, it } from "bun:test";
import { KeyedMutex } from "@/utils/mutex";

describe("KeyedMutex Unit Tests", () => {
  it("executes tasks for the same key sequentially in FIFO order", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const task1 = mutex.runExclusive("guild-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("first");
      return 1;
    });

    const task2 = mutex.runExclusive("guild-1", async () => {
      order.push("second");
      return 2;
    });

    const task3 = mutex.runExclusive("guild-1", async () => {
      order.push("third");
      return 3;
    });

    const results = await Promise.all([task1, task2, task3]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(["first", "second", "third"]);
    expect(mutex.size).toBe(0);
  });

  it("executes tasks for different keys concurrently without blocking each other", async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const slowTask = mutex.runExclusive("key-slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("slow");
    });

    const fastTask = mutex.runExclusive("key-fast", async () => {
      order.push("fast");
    });

    await Promise.all([slowTask, fastTask]);

    expect(order).toEqual(["fast", "slow"]);
    expect(mutex.size).toBe(0);
  });

  it("recovers and continues subsequent tasks if a previous task rejects", async () => {
    const mutex = new KeyedMutex();
    const executed: string[] = [];

    const failingTask = mutex.runExclusive("key-err", async () => {
      throw new Error("Task failed");
    });

    const succeedingTask = mutex.runExclusive("key-err", async () => {
      executed.push("recovered");
      return "ok";
    });

    await expect(failingTask).rejects.toThrow("Task failed");
    const result = await succeedingTask;

    expect(result).toBe("ok");
    expect(executed).toEqual(["recovered"]);
    expect(mutex.size).toBe(0);
  });
});
