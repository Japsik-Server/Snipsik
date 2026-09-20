import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export type SafeHttpResponse = {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
};

export type SafeHttpResolver = (hostname: string) => Promise<LookupAddress[]>;

export type SafeHttpTransport = (
  url: URL,
  address: LookupAddress,
  signal: AbortSignal,
) => Promise<SafeHttpResponse>;

export type SafeHttpOptions = {
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: SafeHttpResolver;
  transport?: SafeHttpTransport;
};

export class SafeHttpError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_URL"
      | "BLOCKED_ADDRESS"
      | "DNS_FAILURE"
      | "TOO_MANY_REDIRECTS"
      | "TIMEOUT"
      | "NETWORK_ERROR",
  ) {
    super(message);
    this.name = "SafeHttpError";
  }
}

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return !blockedIpv6Addresses.check(address, "ipv6");
  return false;
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeHttpError("Invalid target URL", "INVALID_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeHttpError(
      "Only HTTP and HTTPS URLs are allowed",
      "INVALID_URL",
    );
  }
  if (url.username || url.password || !url.hostname) {
    throw new SafeHttpError(
      "URL credentials and empty hostnames are not allowed",
      "INVALID_URL",
    );
  }
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function defaultResolver(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function resolvePublicAddress(
  url: URL,
  resolver: SafeHttpResolver = defaultResolver,
  signal?: AbortSignal,
): Promise<LookupAddress> {
  const hostname = normalizeHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SafeHttpError("Local addresses are not allowed", "BLOCKED_ADDRESS");
  }

  const literalFamily = isIP(hostname);
  let addresses: LookupAddress[];
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await (signal
          ? abortable(resolver(hostname), signal)
          : resolver(hostname));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const message = error instanceof Error ? error.message : String(error);
    throw new SafeHttpError(`DNS lookup failed: ${message}`, "DNS_FAILURE");
  }

  if (addresses.length === 0) {
    throw new SafeHttpError("DNS lookup returned no addresses", "DNS_FAILURE");
  }
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new SafeHttpError(
      "The target resolves to a non-public address",
      "BLOCKED_ADDRESS",
    );
  }

  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (!selected) {
    throw new SafeHttpError("DNS lookup returned no addresses", "DNS_FAILURE");
  }
  return selected;
}

const defaultTransport: SafeHttpTransport = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: "GET",
        signal,
        headers: { "User-Agent": "Snipsik-HealthChecker/1.0" },
        lookup: (_hostname, _options, callback) => {
          if (_options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const result: SafeHttpResponse = {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? "",
          headers: response.headers,
        };
        response.destroy();
        resolve(result);
      },
    );
    req.on("error", reject);
    req.end();
  });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function safeHttpGet(
  rawUrl: string,
  options: SafeHttpOptions = {},
): Promise<SafeHttpResponse> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxRedirects = options.maxRedirects ?? 5;
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? defaultTransport;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new SafeHttpError("Request timed out", "TIMEOUT"));
  }, timeoutMs);

  try {
    let url = parseHttpUrl(rawUrl);
    for (let redirectCount = 0; ; redirectCount++) {
      const address = await resolvePublicAddress(
        url,
        resolver,
        controller.signal,
      );
      const response = await abortable(
        transport(url, address, controller.signal),
        controller.signal,
      );
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.location;
      if (!location) return response;
      if (redirectCount >= maxRedirects) {
        throw new SafeHttpError(
          `Too many redirects (maximum ${maxRedirects})`,
          "TOO_MANY_REDIRECTS",
        );
      }
      try {
        url = parseHttpUrl(new URL(location, url).href);
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;
        throw new SafeHttpError("Invalid redirect URL", "INVALID_URL");
      }
    }
  } catch (error) {
    if (timedOut) {
      throw new SafeHttpError(
        `Request Timeout (${Math.ceil(timeoutMs / 1000)}s)`,
        "TIMEOUT",
      );
    }
    if (error instanceof SafeHttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SafeHttpError(message, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}
