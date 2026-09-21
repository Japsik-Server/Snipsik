import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  clearDashboardLinkSnapshots,
  getDashboardLinkSnapshot,
  storeDashboardLinkSnapshots,
} from "@/services/dashboardLinkSnapshot";
import { SinkClient, sinkClient } from "@/services/sinkClient";
import {
  buildEditLinkPayload,
  onInteractionCreate,
} from "@/events/interactionCreate";
import { CustomId } from "@/types/bot";
import { getUserHash } from "@/services/slugManager";
import { createIgnoredDomainsContent, ui } from "@/utils/ui";
import { parseExpiration } from "@/utils/time";
import { parseTagsInput } from "@/utils/tags";

afterEach(() => {
  clearDashboardLinkSnapshots();
});

describe("expiration parsing", () => {
  const now = Date.UTC(2026, 8, 21, 0, 0, 0);

  it("distinguishes omitted and valid relative or absolute values", () => {
    expect(parseExpiration("", now)).toEqual({ kind: "omitted" });
    expect(parseExpiration("1h", now)).toEqual({
      kind: "valid",
      value: Math.floor(now / 1000) + 3600,
    });
    expect(parseExpiration("2026-09-22", now)).toEqual({
      kind: "valid",
      value: Math.floor(Date.UTC(2026, 8, 22, 23, 59, 59) / 1000),
    });
    expect(parseExpiration("2026-09-21T12:00:00+09:00", now).kind).toBe(
      "valid",
    );
    expect(parseExpiration("1000y", now).kind).toBe("valid");
  });

  it("rejects typos, past dates, invalid calendar dates, and overflow", () => {
    expect(parseExpiration("1hour", now).kind).toBe("invalid");
    expect(parseExpiration("2026-09-20", now).kind).toBe("invalid");
    expect(parseExpiration("2026-02-30", now).kind).toBe("invalid");
    expect(parseExpiration("999999999999999999999999y", now).kind).toBe(
      "invalid",
    );
  });
});

describe("Sink tag and edit contracts", () => {
  it("normalizes comma-separated Discord tag input", () => {
    expect(parseTagsInput("#Docs, Release, docs")).toEqual({
      valid: true,
      value: ["docs", "release"],
    });
    expect(
      parseTagsInput(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","))
        .valid,
    ).toBe(false);
  });

  it("serializes deletion semantics while preserving fields outside the modal", () => {
    const payload = buildEditLinkPayload(
      {
        slug: "slug",
        url: "https://old.example",
        title: "old title",
        description: "old description",
        tags: ["old"],
        expiration: 2_000_000_000,
        unsafe: false,
        cloaking: true,
        redirectWithQuery: false,
        geo: { KR: "https://kr.example" },
      },
      {
        url: "https://new.example",
        title: "",
        description: "",
        tags: [],
      },
    );

    const serialized = JSON.parse(JSON.stringify(payload));
    expect(serialized).toEqual({
      url: "https://new.example",
      tags: [],
      expiration: 2_000_000_000,
      cloaking: true,
      redirectWithQuery: false,
      geo: { KR: "https://kr.example" },
      unsafe: false,
    });
    expect(serialized).not.toHaveProperty("title");
    expect(serialized).not.toHaveProperty("description");
    expect(serialized).not.toHaveProperty("password");

    const clearPassword = buildEditLinkPayload(
      { slug: "slug", url: "https://old.example" },
      {
        url: "https://old.example",
        title: "title",
        description: "description",
        tags: ["tag"],
        password: "",
      },
    );
    expect(JSON.parse(JSON.stringify(clearPassword)).password).toBe("");
  });

  it("uses official tags and Unix-seconds response fields", async () => {
    const client = new SinkClient({
      baseUrl: "https://sink.example",
      token: "token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            slug: "official",
            url: "https://example.com",
            tags: ["docs", "release"],
            expiration: 2_000_000_000,
          }),
          { status: 200 },
        ),
    });
    const result = await client.queryLink({ slug: "official" });
    expect(result.link?.tags).toEqual(["docs", "release"]);
    expect(result.link?.expiration).toBe(2_000_000_000);
  });
});

describe("dashboard snapshot and Discord ACK", () => {
  it("expires cloned dashboard snapshots after five minutes", () => {
    const link = {
      slug: "cached",
      url: "https://example.com",
      tags: ["one"],
    };
    storeDashboardLinkSnapshots("user", [link], 1_000);
    const cached = getDashboardLinkSnapshot("user", "cached", 2_000);
    expect(cached).toEqual(link);
    cached?.tags?.push("mutated");
    expect(getDashboardLinkSnapshot("user", "cached", 2_000)?.tags).toEqual([
      "one",
    ]);
    expect(
      getDashboardLinkSnapshot("user", "cached", 1_000 + 5 * 60 * 1000),
    ).toBeUndefined();
  });

  it("opens a cached edit modal without an external lookup", async () => {
    const userId = "723319776407191633";
    const slug = `edit-${getUserHash(userId)}`;
    storeDashboardLinkSnapshots(userId, [
      { slug, url: "https://example.com", title: "Existing", tags: ["docs"] },
    ]);
    const originalGetLink = sinkClient.getLink;
    const getLinkMock = mock(async () => ({ success: false }));
    sinkClient.getLink = getLinkMock;
    let shownModal: unknown;
    const interaction = {
      customId: `${CustomId.DASHBOARD_EDIT_BTN}:${slug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      showModal: async (modal: unknown) => {
        shownModal = modal;
      },
    };

    try {
      await onInteractionCreate(interaction as never);
      expect(shownModal).toBeDefined();
      expect(getLinkMock).not.toHaveBeenCalled();
    } finally {
      sinkClient.getLink = originalGetLink;
    }
  });

  it("rejects an invalid edit-button slug before reading the snapshot", async () => {
    const userId = "723319776407191633";
    const invalidSlug = `${"x".repeat(101)}-${getUserHash(userId)}`;
    let replyPayload: unknown;
    let shownModal: unknown;
    const interaction = {
      customId: `${CustomId.DASHBOARD_EDIT_BTN}:${invalidSlug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      reply: async (payload: unknown) => {
        replyPayload = payload;
      },
      showModal: async (modal: unknown) => {
        shownModal = modal;
      },
    };

    await onInteractionCreate(interaction as never);
    expect(replyPayload).toBeDefined();
    expect(shownModal).toBeUndefined();
  });

  it("rejects an invalid edit-modal slug before calling Sink", async () => {
    const userId = "723319776407191633";
    const invalidSlug = `${"x".repeat(101)}-${getUserHash(userId)}`;
    const originalGetLink = sinkClient.getLink;
    const getLinkMock = mock(async () => ({ success: false }));
    sinkClient.getLink = getLinkMock;
    let followUpPayload: unknown;
    const interaction = {
      customId: `${CustomId.MODAL_EDIT_LINK}:${invalidSlug}`,
      user: { id: userId },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      deferUpdate: async () => {},
      followUp: async (payload: unknown) => {
        followUpPayload = payload;
      },
    };

    try {
      await onInteractionCreate(interaction as never);
      expect(followUpPayload).toBeDefined();
      expect(getLinkMock).not.toHaveBeenCalled();
    } finally {
      sinkClient.getLink = originalGetLink;
    }
  });

  it("acknowledges delete before starting the Sink mutation", async () => {
    const userId = "723319776407191633";
    const slug = `delete-${getUserHash(userId)}`;
    const events: string[] = [];
    const originalDelete = sinkClient.deleteLink;
    sinkClient.deleteLink = mock(async () => {
      events.push("delete");
      return { success: false, error: "slow failure" };
    });
    const interaction = {
      customId: `${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`,
      user: { id: userId },
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {
        events.push("defer");
      },
      editReply: async () => {
        events.push("edit");
      },
    };

    try {
      await onInteractionCreate(interaction as never);
      expect(events).toEqual(["defer", "delete", "edit"]);
    } finally {
      sinkClient.deleteLink = originalDelete;
    }
  });

  it("acknowledges dashboard refresh before external reads", async () => {
    const events: string[] = [];
    const originalCount = sinkClient.countLinks;
    const originalSearch = sinkClient.searchLinks;
    sinkClient.countLinks = mock(async () => {
      events.push("external");
      return { success: true, count: 0 };
    });
    sinkClient.searchLinks = mock(async () => {
      events.push("external");
      return { success: true, list: [], total: 0 };
    });
    const interaction = {
      customId: `${CustomId.DASHBOARD_REFRESH_BTN}:1`,
      user: { id: "723319776407191633", username: "Tester" },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {
        events.push("defer");
      },
      editReply: async () => {
        events.push("edit");
      },
    };

    try {
      await onInteractionCreate(interaction as never);
      expect(events[0]).toBe("defer");
      expect(events.filter((event) => event === "external")).toHaveLength(4);
      expect(events.at(-1)).toBe("edit");
    } finally {
      sinkClient.countLinks = originalCount;
      sinkClient.searchLinks = originalSearch;
    }
  });

  it("rejects invalid modal expiration without calling Sink", async () => {
    const originalCreate = sinkClient.createLink;
    const createMock = mock(async () => ({ success: true }));
    sinkClient.createLink = createMock;
    const values: Record<string, string> = {
      url: "https://example.com",
      expiration: "1hour",
      password: "",
      tag: "",
      title: "",
    };
    let followUpPayload: unknown;
    const interaction = {
      customId: CustomId.MODAL_CREATE_LINK,
      user: { id: "723319776407191633" },
      fields: { getTextInputValue: (key: string) => values[key] || "" },
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      deferUpdate: async () => {},
      followUp: async (payload: unknown) => {
        followUpPayload = payload;
      },
    };

    try {
      await onInteractionCreate(interaction as never);
      expect(followUpPayload).toBeDefined();
      expect(createMock).not.toHaveBeenCalled();
    } finally {
      sinkClient.createLink = originalCreate;
    }
  });
});

describe("configuration display budget", () => {
  it("renders near-limit domain settings within the component budget", () => {
    const domains = Array.from(
      { length: 50 },
      (_, index) => `${"segment".repeat(10)}-${index}.example.com`,
    );
    const content = createIgnoredDomainsContent(domains);
    expect(content.length).toBeLessThanOrEqual(3_500);
    expect(content).toContain("전체 50개");
    expect(content).toContain("생략됨");

    const view = ui.createConfigPanelView(
      { id: "user", username: "Tester" } as never,
      {
        autoDmMode: "inherit",
        dmFormat: "replace",
        fixupxEnabled: true,
        autoShortenMinUrlLength: null,
        ignoredDomains: domains,
      },
    );
    expect(() => view.components[0]?.toJSON()).not.toThrow();
  });
});
