import { logger } from "@/utils/logger";

export type CacheState = "uninitialized" | "loading" | "ready" | "degraded";

export interface CacheStatus {
  state: CacheState;
  usable: boolean;
  retryAttempt: number;
  lastLoadedAt: number | null;
  lastError: string | null;
}

export interface CacheRecoveryOptions {
  retryDelaysMs?: readonly number[];
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

/** Coordinates single-flight cache loading, observable state, and capped retries. */
export class CacheRecoveryController {
  private state: CacheState = "uninitialized";
  private hasSnapshot = false;
  private retryAttempt = 0;
  private lastLoadedAt: number | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly retryDelaysMs: readonly number[];
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(
    private readonly name: string,
    private readonly loader: () => Promise<void>,
    options: CacheRecoveryOptions = {},
  ) {
    this.retryDelaysMs =
      options.retryDelaysMs && options.retryDelaysMs.length > 0
        ? options.retryDelaysMs
        : DEFAULT_RETRY_DELAYS_MS;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  getStatus(): CacheStatus {
    return {
      state: this.state,
      usable: this.hasSnapshot,
      retryAttempt: this.retryAttempt,
      lastLoadedAt: this.lastLoadedAt,
      lastError: this.lastError,
    };
  }

  isUsable(): boolean {
    return this.hasSnapshot;
  }

  start(): Promise<void> {
    this.stopped = false;
    return this.loadNow();
  }

  ensureLoading(): void {
    if (this.stopped) {
      this.stopped = false;
    }
    if (this.state === "ready" || this.inFlight || this.retryTimer) {
      return;
    }
    void this.loadNow().catch(() => {});
  }

  loadNow(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }

    this.state = "loading";
    let loadPromise: Promise<void>;
    try {
      loadPromise = this.loader();
    } catch (error) {
      loadPromise = Promise.reject(error);
    }

    const operation = loadPromise
      .then(() => {
        this.hasSnapshot = true;
        this.state = "ready";
        this.retryAttempt = 0;
        this.lastLoadedAt = Date.now();
        this.lastError = null;
      })
      .catch((error: unknown) => {
        this.state = this.hasSnapshot ? "degraded" : "uninitialized";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.retryAttempt += 1;
        this.scheduleRetry();
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = operation;
    return operation;
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  setUsableForTest(usable: boolean): void {
    this.stop();
    this.hasSnapshot = usable;
    this.state = usable ? "ready" : "uninitialized";
    this.retryAttempt = 0;
    this.lastLoadedAt = usable ? Date.now() : null;
    this.lastError = null;
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) {
      return;
    }

    const delayIndex = Math.min(
      Math.max(this.retryAttempt - 1, 0),
      this.retryDelaysMs.length - 1,
    );
    const delay = this.retryDelaysMs[delayIndex] ?? 30_000;
    logger.warn(
      `${this.name} cache reload scheduled in ${delay}ms (attempt ${this.retryAttempt}).`,
    );

    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (!this.stopped) {
        void this.loadNow().catch(() => {});
      }
    }, delay);
    this.retryTimer.unref?.();
  }
}
