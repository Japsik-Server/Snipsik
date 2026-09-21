export type ExpirationParseResult =
  | { kind: "omitted" }
  | { kind: "valid"; value: number }
  | { kind: "invalid"; error: string };

const UNIT_SECONDS: Record<string, bigint> = {
  s: 1n,
  m: 60n,
  h: 3_600n,
  d: 86_400n,
  w: 604_800n,
  y: 31_536_000n,
};

const INVALID_EXPIRATION_MESSAGE =
  "만료 기간은 미래 시각의 ISO 날짜 또는 10m, 1h, 7d 형식으로 입력해주세요.";

/** Parses Discord expiration input into the Unix-seconds contract used by Sink. */
export function parseExpiration(
  input?: string | null,
  nowMs = Date.now(),
): ExpirationParseResult {
  if (!input || !input.trim()) return { kind: "omitted" };

  const trimmed = input.trim().toLowerCase();
  const relative = trimmed.match(/^(\d+)\s*(s|m|h|d|w|y)?$/);
  let unixSeconds: number;

  if (relative) {
    const amount = BigInt(relative[1]!);
    const unit = relative[2] || "s";
    const target =
      BigInt(Math.floor(nowMs / 1000)) + amount * UNIT_SECONDS[unit]!;
    if (target > BigInt(Number.MAX_SAFE_INTEGER)) {
      return {
        kind: "invalid",
        error: "만료 시각이 표현 가능한 범위를 벗어났습니다.",
      };
    }
    unixSeconds = Number(target);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    const date = new Date(`${trimmed}T23:59:59.000Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day
    ) {
      return { kind: "invalid", error: INVALID_EXPIRATION_MESSAGE };
    }
    unixSeconds = Math.floor(date.getTime() / 1000);
  } else if (
    /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:z|[+-]\d{2}:\d{2})$/i.test(
      trimmed,
    )
  ) {
    const parsedMs = Date.parse(trimmed);
    if (!Number.isFinite(parsedMs)) {
      return { kind: "invalid", error: INVALID_EXPIRATION_MESSAGE };
    }
    unixSeconds = Math.floor(parsedMs / 1000);
  } else {
    return { kind: "invalid", error: INVALID_EXPIRATION_MESSAGE };
  }

  if (!Number.isSafeInteger(unixSeconds)) {
    return {
      kind: "invalid",
      error: "만료 시각이 표현 가능한 범위를 벗어났습니다.",
    };
  }
  if (unixSeconds <= Math.floor(nowMs / 1000)) {
    return { kind: "invalid", error: "만료 시각은 현재보다 미래여야 합니다." };
  }

  return { kind: "valid", value: unixSeconds };
}

/** Converts official Unix seconds and legacy ISO timestamps into Unix seconds. */
export function expirationToUnixSeconds(
  value: string | number | null | undefined,
): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
    const parsedMs = Date.parse(value);
    if (Number.isFinite(parsedMs)) return Math.floor(parsedMs / 1000);
  }
  return undefined;
}

export function timestampToMilliseconds(
  value: string | number | null | undefined,
): number {
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
