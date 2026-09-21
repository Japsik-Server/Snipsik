import type { SinkLink } from "@/types/sink";

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_ENTRIES = 2_000;

interface SnapshotEntry {
  link: SinkLink;
  expiresAt: number;
}

const snapshots = new Map<string, SnapshotEntry>();

function keyFor(userId: string, slug: string): string {
  return `${userId}:${slug.toLowerCase()}`;
}

function cloneLink(link: SinkLink): SinkLink {
  return {
    ...link,
    tags: link.tags ? [...link.tags] : [],
    geo: link.geo ? { ...link.geo } : undefined,
  };
}

function purgeExpired(now: number): void {
  for (const [key, entry] of snapshots) {
    if (entry.expiresAt <= now) snapshots.delete(key);
  }
}

/** Stores the dashboard response before Discord needs to open a modal synchronously. */
export function storeDashboardLinkSnapshots(
  userId: string,
  links: readonly SinkLink[],
  now = Date.now(),
): void {
  purgeExpired(now);
  for (const link of links) {
    const key = keyFor(userId, link.slug);
    snapshots.delete(key);
    snapshots.set(key, {
      link: cloneLink(link),
      expiresAt: now + SNAPSHOT_TTL_MS,
    });
  }
  while (snapshots.size > MAX_SNAPSHOT_ENTRIES) {
    const oldestKey = snapshots.keys().next().value;
    if (typeof oldestKey !== "string") break;
    snapshots.delete(oldestKey);
  }
}

export function getDashboardLinkSnapshot(
  userId: string,
  slug: string,
  now = Date.now(),
): SinkLink | undefined {
  const key = keyFor(userId, slug);
  const entry = snapshots.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    snapshots.delete(key);
    return undefined;
  }
  return cloneLink(entry.link);
}

export function clearDashboardLinkSnapshots(): void {
  snapshots.clear();
}
