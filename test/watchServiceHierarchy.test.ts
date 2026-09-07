import { describe, expect, it, beforeEach } from "bun:test";
import {
  watchService,
  type WatchableChannelLike,
} from "@/services/watchService";
import { onChannelDelete } from "@/events/channelDelete";
import { onThreadDelete } from "@/events/threadDelete";

describe("WatchService Hierarchy & Special Channel Tests", () => {
  const guildId = "guild-123456";

  beforeEach(() => {
    // Clear watched channel cache
    // @ts-expect-error accessing private cache for testing
    watchService.watchedChannelKeys.clear();
  });

  describe("isChannelWatched hierarchy resolution", () => {
    it("returns true for directly watched text or voice channel", () => {
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:channel-direct`);

      const channel: WatchableChannelLike = {
        id: "channel-direct",
      };

      expect(watchService.isChannelWatched(guildId, channel)).toBe(true);
    });

    it("returns false for unwatched channel with no parent", () => {
      const channel: WatchableChannelLike = {
        id: "channel-unwatched",
      };

      expect(watchService.isChannelWatched(guildId, channel)).toBe(false);
    });

    it("inherits watch status from watched forum channel for threads/posts", () => {
      const forumId = "forum-999";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${forumId}`);

      const threadInForum: WatchableChannelLike = {
        id: "post-111",
        parentId: forumId,
        isThread: () => true,
      };

      expect(watchService.isChannelWatched(guildId, threadInForum)).toBe(true);
    });

    it("inherits watch status from watched text channel for threads", () => {
      const textChannelId = "text-ch-123";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${textChannelId}`);

      const threadInText: WatchableChannelLike = {
        id: "thread-456",
        parentId: textChannelId,
        isThread: () => true,
      };

      expect(watchService.isChannelWatched(guildId, threadInText)).toBe(true);
    });

    it("inherits watch status from watched category for regular channels (voice/text)", () => {
      const categoryId = "category-777";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${categoryId}`);

      const voiceChannel: WatchableChannelLike = {
        id: "voice-ch-1",
        parentId: categoryId,
        isThread: () => false,
      };

      expect(watchService.isChannelWatched(guildId, voiceChannel)).toBe(true);
    });

    it("inherits watch status from watched category for threads via directParentCategory", () => {
      const categoryId = "category-777";
      const forumId = "forum-888";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${categoryId}`);

      const threadInForum: WatchableChannelLike = {
        id: "post-222",
        parentId: forumId,
        isThread: () => true,
        parent: {
          parentId: categoryId,
        },
      };

      expect(watchService.isChannelWatched(guildId, threadInForum)).toBe(true);
    });

    it("inherits watch status from watched category for threads via guild channel cache fallback", () => {
      const categoryId = "category-777";
      const forumId = "forum-888";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${categoryId}`);

      const cachedParent = {
        id: forumId,
        parentId: categoryId,
      };

      const threadWithCacheLookup: WatchableChannelLike = {
        id: "post-333",
        parentId: forumId,
        isThread: () => true,
        parent: null,
        guild: {
          channels: {
            cache: {
              get: (id: string) => (id === forumId ? cachedParent : null),
            },
          },
        },
      };

      expect(
        watchService.isChannelWatched(guildId, threadWithCacheLookup),
      ).toBe(true);
    });
  });

  describe("findWatchingParent", () => {
    it("identifies direct parent channel (forum or text) when watched", () => {
      const forumId = "forum-123";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${forumId}`);

      const thread: WatchableChannelLike = {
        id: "thread-1",
        parentId: forumId,
        isThread: () => true,
      };

      expect(watchService.findWatchingParent(guildId, thread)).toBe(forumId);
    });

    it("identifies grandparent category when thread is under a watched category", () => {
      const categoryId = "category-abc";
      const textChannelId = "channel-sub";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${categoryId}`);

      const thread: WatchableChannelLike = {
        id: "thread-2",
        parentId: textChannelId,
        isThread: () => true,
        parent: {
          parentId: categoryId,
        },
      };

      expect(watchService.findWatchingParent(guildId, thread)).toBe(categoryId);
    });

    it("returns null when neither parent nor grandparent is watched", () => {
      const thread: WatchableChannelLike = {
        id: "thread-3",
        parentId: "some-unwatched-parent",
        isThread: () => true,
      };

      expect(watchService.findWatchingParent(guildId, thread)).toBeNull();
    });
  });

  describe("onChannelDelete and onThreadDelete automatic cleanup", () => {
    it("removes channel from watch list when channel is deleted", async () => {
      const channelId = "deleted-channel-1";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${channelId}`);

      let removeCalled = false;
      const originalRemove = watchService.removeWatchChannel;
      watchService.removeWatchChannel = async (gId, chId) => {
        if (gId === guildId && chId === channelId) {
          removeCalled = true;
        }
        return { success: true };
      };

      try {
        const mockChannel = {
          id: channelId,
          guild: { id: guildId },
        } as any;

        await onChannelDelete(mockChannel);
        expect(removeCalled).toBe(true);
      } finally {
        watchService.removeWatchChannel = originalRemove;
      }
    });

    it("ignores channel deletion if channel was not watched", async () => {
      let removeCalled = false;
      const originalRemove = watchService.removeWatchChannel;
      watchService.removeWatchChannel = async () => {
        removeCalled = true;
        return { success: true };
      };

      try {
        const mockChannel = {
          id: "unwatched-channel",
          guild: { id: guildId },
        } as any;

        await onChannelDelete(mockChannel);
        expect(removeCalled).toBe(false);
      } finally {
        watchService.removeWatchChannel = originalRemove;
      }
    });

    it("removes thread from watch list when thread is deleted", async () => {
      const threadId = "deleted-thread-1";
      // @ts-expect-error accessing private cache for testing
      watchService.watchedChannelKeys.add(`${guildId}:${threadId}`);

      let removeCalled = false;
      const originalRemove = watchService.removeWatchChannel;
      watchService.removeWatchChannel = async (gId, thId) => {
        if (gId === guildId && thId === threadId) {
          removeCalled = true;
        }
        return { success: true };
      };

      try {
        const mockThread = {
          id: threadId,
          guild: { id: guildId },
        } as any;

        await onThreadDelete(mockThread);
        expect(removeCalled).toBe(true);
      } finally {
        watchService.removeWatchChannel = originalRemove;
      }
    });
  });
});
