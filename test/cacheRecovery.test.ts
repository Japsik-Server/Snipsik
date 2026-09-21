import { describe, expect, it } from "bun:test";
import { CacheRecoveryController } from "@/services/cacheRecovery";
import { WatchService } from "@/services/watchService";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CacheRecoveryController", () => {
  it("retries a failed initial load and becomes ready after recovery", async () => {
    let calls = 0;
    let scheduled: (() => void) | null = null;
    let scheduledDelay = -1;
    const setTimer = ((callback: () => void, delay?: number) => {
      scheduled = callback;
      scheduledDelay = delay ?? 0;
      return { unref() {} };
    }) as unknown as typeof setTimeout;
    const controller = new CacheRecoveryController(
      "test",
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("database unavailable");
      },
      { setTimer },
    );

    await expect(controller.start()).rejects.toThrow("database unavailable");
    expect(controller.getStatus()).toMatchObject({
      state: "uninitialized",
      usable: false,
      retryAttempt: 1,
      lastError: "database unavailable",
    });
    expect(scheduledDelay).toBe(1_000);

    const retry = scheduled as (() => void) | null;
    expect(retry).not.toBeNull();
    retry?.();
    await Bun.sleep(0);

    expect(calls).toBe(2);
    expect(controller.getStatus()).toMatchObject({
      state: "ready",
      usable: true,
      retryAttempt: 0,
      lastError: null,
    });
  });

  it("keeps the last successful snapshot usable after a reload failure", async () => {
    let shouldFail = false;
    const controller = new CacheRecoveryController(
      "test",
      async () => {
        if (shouldFail) throw new Error("temporary failure");
      },
      { setTimer: (() => ({ unref() {} })) as unknown as typeof setTimeout },
    );

    await controller.start();
    shouldFail = true;
    await expect(controller.loadNow()).rejects.toThrow("temporary failure");

    expect(controller.getStatus()).toMatchObject({
      state: "degraded",
      usable: true,
      retryAttempt: 1,
      lastError: "temporary failure",
    });
  });

  it("backs off exponentially and caps retries at thirty seconds", async () => {
    const delays: number[] = [];
    const controller = new CacheRecoveryController(
      "test",
      async () => {
        throw new Error("still unavailable");
      },
      {
        setTimer: ((_: () => void, delay?: number) => {
          delays.push(delay ?? 0);
          return { unref() {} };
        }) as unknown as typeof setTimeout,
        clearTimer: (() => {}) as unknown as typeof clearTimeout,
      },
    );

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await expect(controller.loadNow()).rejects.toThrow("still unavailable");
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    controller.stop();
  });

  it("coalesces concurrent loads and clears a scheduled retry on stop", async () => {
    const pending = deferred<void>();
    let calls = 0;
    let clearCalls = 0;
    const timerHandle = { unref() {} };
    const controller = new CacheRecoveryController(
      "test",
      () => {
        calls += 1;
        return calls === 1 ? pending.promise : Promise.reject(new Error("fail"));
      },
      {
        setTimer: (() => timerHandle) as unknown as typeof setTimeout,
        clearTimer: ((handle: unknown) => {
          if (handle === timerHandle) clearCalls += 1;
        }) as unknown as typeof clearTimeout,
      },
    );

    const first = controller.start();
    const second = controller.loadNow();
    expect(calls).toBe(1);
    pending.resolve();
    await Promise.all([first, second]);

    await expect(controller.loadNow()).rejects.toThrow("fail");
    controller.stop();
    expect(clearCalls).toBe(1);
  });
});

describe("Watch cache snapshot reconciliation", () => {
  it("preserves additions and deletions made while a snapshot is loading", async () => {
    const pending = deferred<
      Array<{ guildId: string; channelId: string }>
    >();
    const service = new WatchService(() => pending.promise);
    const loading = service.startCacheRecovery();

    // Simulate successful DB mutations while the initial SELECT is in flight.
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:old", false);
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:new", true);
    // Only the latest mutation for a key should survive reconciliation.
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:removed", true);
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:removed", false);
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:restored", false);
    // @ts-expect-error exercising the service's reconciliation boundary
    service.recordCacheMutation("guild:restored", true);
    pending.resolve([
      { guildId: "guild", channelId: "old" },
      { guildId: "guild", channelId: "removed" },
    ]);
    await loading;

    expect(service.isWatched("guild", "old")).toBe(false);
    expect(service.isWatched("guild", "new")).toBe(true);
    expect(service.isWatched("guild", "removed")).toBe(false);
    expect(service.isWatched("guild", "restored")).toBe(true);
    expect(service.getCacheStatus().state).toBe("ready");
    service.stopCacheRecovery();
  });
});
