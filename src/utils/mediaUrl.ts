/**
 * Returns whether an URL should be left untouched by automatic shortening.
 * Media links are intentionally excluded to avoid unnecessary auto-shortening
 * and DMs for content that Discord can already render directly.
 */
export function isAutoShortenExcludedMediaUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  const mediaHosts = [
    "tenor.com",
    "giphy.com",
    "gph.is",
    "cdn.discordapp.com",
    "media.discordapp.com",
    "discordapp.net",
  ];

  if (
    mediaHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    )
  ) {
    return true;
  }

  return /\.gif$/i.test(url.pathname);
}
