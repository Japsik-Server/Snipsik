import { describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { WatchService } from "@/services/watchService";
import type { WatchChannel } from "@/db/schema";

describe("watch storage consistency", () => {
  it("deduplicates existing rows before adding the composite unique index", async () => {
    const client = createClient({ url: "file::memory:" });
    await client.executeMultiple(`
      CREATE TABLE watch_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO watch_channels (guild_id, channel_id, created_by, created_at)
      VALUES ('guild', 'channel', 'first', 1), ('guild', 'channel', 'second', 2);
    `);
    const migration = await Bun.file(
      new URL(
        "../drizzle/0001_deduplicate_watch_channels_and_add_unique_index.sql",
        import.meta.url,
      ),
    ).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement);
    }

    const rows = await client.execute(
      "SELECT created_by FROM watch_channels WHERE guild_id = 'guild' AND channel_id = 'channel'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.created_by).toBe("first");
    await expect(
      client.execute({
        sql: "INSERT INTO watch_channels (guild_id, channel_id, created_by, created_at) VALUES (?, ?, ?, ?)",
        args: ["guild", "channel", "third", 3],
      }),
    ).rejects.toThrow();
    client.close();
  });

  it("keeps one row for concurrent conflict-safe inserts in LibSQL", async () => {
    const client = createClient({ url: "file::memory:" });
    await client.executeMultiple(`
      CREATE TABLE watch_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX watch_channels_guild_id_channel_id_unique
      ON watch_channels (guild_id, channel_id);
    `);
    const insert = (createdBy: string) =>
      client.execute({
        sql: `INSERT INTO watch_channels
          (guild_id, channel_id, created_by, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (guild_id, channel_id) DO NOTHING
          RETURNING id`,
        args: ["guild", "channel", createdBy, Date.now()],
      });

    const results = await Promise.all([insert("user-a"), insert("user-b")]);
    expect(results.map((result) => result.rows.length).sort()).toEqual([0, 1]);
    const count = await client.execute(
      "SELECT COUNT(*) AS count FROM watch_channels",
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
    client.close();
  });

  it("returns one success and one stable duplicate result for concurrent adds", async () => {
    let stored: WatchChannel | undefined;
    let nextId = 1;
    const insertRecord = async (
      values: Pick<WatchChannel, "guildId" | "channelId" | "createdBy">,
    ): Promise<WatchChannel | undefined> => {
      await Promise.resolve();
      if (stored) return undefined;
      stored = {
        ...values,
        id: nextId++,
        createdAt: new Date(),
      };
      return stored;
    };
    const service = new WatchService(async () => [], insertRecord);

    const results = await Promise.all([
      service.addWatchChannel("guild", "channel", "user-a"),
      service.addWatchChannel("guild", "channel", "user-b"),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toEqual([
      {
        success: false,
        error: "This channel is already being watched.",
      },
    ]);
    expect(service.isWatched("guild", "channel")).toBe(true);
    expect(stored).toBeDefined();
  });
});
