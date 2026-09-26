/** Deployment requires live Discord, a responsive DB, and freshly loaded policy caches. */
export function isDeploymentReady(
  discordConnected: boolean,
  dbAvailable: boolean,
  cacheStates: readonly string[],
): boolean {
  return discordConnected && dbAvailable && cacheStates.every((state) => state === "ready");
}
