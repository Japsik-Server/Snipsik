import { describe, expect, it } from "bun:test";
import {
  isPublicIpAddress,
  safeHttpGet,
  type SafeHttpResolver,
  type SafeHttpTransport,
} from "@/utils/safeHttp";

const publicResolver: SafeHttpResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("safe HTTP URL checks", () => {
  it("classifies public and non-public IPv4/IPv6 addresses", () => {
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicIpAddress(address)).toBe(false);
    }
  });

  it("rejects non-HTTP protocols before transport", async () => {
    let called = false;
    await expect(
      safeHttpGet("file:///etc/passwd", {
        transport: async () => {
          called = true;
          throw new Error("must not run");
        },
      }),
    ).rejects.toThrow("Only HTTP and HTTPS");
    expect(called).toBe(false);
  });

  it("rejects loopback, private, and mixed DNS results before transport", async () => {
    for (const addresses of [
      [{ address: "127.0.0.1", family: 4 as const }],
      [{ address: "192.168.1.2", family: 4 as const }],
      [
        { address: "93.184.216.34", family: 4 as const },
        { address: "10.0.0.2", family: 4 as const },
      ],
    ]) {
      let called = false;
      await expect(
        safeHttpGet("https://example.test", {
          resolver: async () => addresses,
          transport: async () => {
            called = true;
            throw new Error("must not run");
          },
        }),
      ).rejects.toThrow("non-public address");
      expect(called).toBe(false);
    }
  });

  it("pins the validated address and follows safe relative redirects", async () => {
    const calls: Array<{ url: string; address: string }> = [];
    const transport: SafeHttpTransport = async (url, address) => {
      calls.push({ url: url.href, address: address.address });
      return calls.length === 1
        ? { status: 302, statusText: "Found", headers: { location: "/final" } }
        : { status: 200, statusText: "OK", headers: {} };
    };

    const response = await safeHttpGet("https://example.test/start", {
      resolver: publicResolver,
      transport,
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { url: "https://example.test/start", address: "93.184.216.34" },
      { url: "https://example.test/final", address: "93.184.216.34" },
    ]);
  });

  it("blocks a redirect from a public host to a private address", async () => {
    let calls = 0;
    await expect(
      safeHttpGet("https://example.test/start", {
        resolver: publicResolver,
        transport: async () => {
          calls++;
          return {
            status: 302,
            statusText: "Found",
            headers: { location: "http://127.0.0.1/admin" },
          };
        },
      }),
    ).rejects.toThrow("non-public address");
    expect(calls).toBe(1);
  });

  it("enforces redirect and total time limits", async () => {
    await expect(
      safeHttpGet("https://example.test/start", {
        maxRedirects: 1,
        resolver: publicResolver,
        transport: async () => ({
          status: 302,
          statusText: "Found",
          headers: { location: "/again" },
        }),
      }),
    ).rejects.toThrow("Too many redirects");

    await expect(
      safeHttpGet("https://example.test/slow", {
        timeoutMs: 20,
        resolver: publicResolver,
        transport: async (_url, _address, signal) =>
          await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      }),
    ).rejects.toThrow("Request Timeout");
  });
});
