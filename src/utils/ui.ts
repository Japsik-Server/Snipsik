import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type User,
} from "discord.js";
import { CustomId, type UserDashboardStats } from "@/types/bot";
import type { SinkLink, SinkStats } from "@/types/sink";
import { getUserHash } from "@/services/slugManager";
import { sinkClient } from "@/services/sinkClient";

const COLORS = {
  PRIMARY: 0x5865f2, // Discord Blurple
  SUCCESS: 0x57f287, // Discord Green
  WARNING: 0xfee75c, // Discord Yellow
  DANGER: 0xed4245,  // Discord Red
  DARK: 0x2b2d31,    // Discord Dark Container
  MUTED: 0x949ba4,   // Discord Gray
};

export const ui = {
  /**
   * Builds the Ephemeral Personal Dashboard view.
   */
  createDashboardView(
    user: User,
    dashboardStats: UserDashboardStats,
    selectedSlug?: string
  ): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
  } {
    const userHash = getUserHash(user.id);
    const embeds: EmbedBuilder[] = [];

    // Main Summary Card
    const summaryEmbed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setAuthor({
        name: `${user.username}'s Link Dashboard`,
        iconURL: user.displayAvatarURL(),
      })
      .setDescription(
        `> **개인 전용 링크 대시보드**에 오신 것을 환영합니다.\n> 고유 유저 해시: \`${userHash}\``
      )
      .addFields(
        {
          name: "📊 총 링크",
          value: `\`${dashboardStats.totalLinks}\` 개`,
          inline: true,
        },
        {
          name: "⚡ 활성 링크",
          value: `\`${dashboardStats.activeLinks}\` 개`,
          inline: true,
        },
        {
          name: "⏳ 만료 링크",
          value: `\`${dashboardStats.expiredLinks}\` 개`,
          inline: true,
        },
        {
          name: "🖱️ 누적 클릭 수",
          value: `\`${dashboardStats.totalClicks.toLocaleString()}\` 회`,
          inline: true,
        }
      )
      .setFooter({ text: "Snipsik • Powered by Sink" })
      .setTimestamp();

    embeds.push(summaryEmbed);

    // If a link is selected, add its detailed view
    const selectedLink = selectedSlug
      ? dashboardStats.recentLinks.find((l) => l.slug === selectedSlug)
      : undefined;

    if (selectedLink) {
      const fullShortUrl = sinkClient.getFullShortUrl(selectedLink.slug);
      const linkEmbed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(`📌 선택된 링크: /${selectedLink.slug}`)
        .setURL(fullShortUrl)
        .setDescription(
          `**단축 URL:** [${fullShortUrl}](${fullShortUrl})\n**원본 URL:** ${selectedLink.url.length > 80 ? `${selectedLink.url.substring(0, 77)}...` : selectedLink.url}`
        )
        .addFields(
          {
            name: "타이틀",
            value: selectedLink.title || "*설정 안 됨*",
            inline: true,
          },
          {
            name: "태그",
            value: selectedLink.tag ? `\`#${selectedLink.tag}\`` : "*없음*",
            inline: true,
          },
          {
            name: "클릭 수",
            value: `\`${(selectedLink.clicks ?? 0).toLocaleString()}\` 회`,
            inline: true,
          },
          {
            name: "비밀번호 보호",
            value: selectedLink.password ? "🔒 설정됨" : "🔓 공개",
            inline: true,
          },
          {
            name: "만료일",
            value: selectedLink.expiration
              ? `<t:${Math.floor(new Date(selectedLink.expiration).getTime() / 1000)}:R>`
              : "♾️ 무제한",
            inline: true,
          }
        );
      embeds.push(linkEmbed);
    }

    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Select Menu Row (if user has links)
    if (dashboardStats.recentLinks.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(CustomId.DASHBOARD_SELECT_LINK)
        .setPlaceholder("📋 관리할 링크를 선택하세요...")
        .setMinValues(1)
        .setMaxValues(1);

      const options = dashboardStats.recentLinks.slice(0, 25).map((l) => {
        const fullUrl = sinkClient.getFullShortUrl(l.slug);
        const opt = new StringSelectMenuOptionBuilder()
          .setLabel(`/${l.slug} ${l.title ? `(${l.title.substring(0, 40)})` : ""}`)
          .setDescription(l.url.substring(0, 95))
          .setValue(l.slug);

        if (selectedSlug === l.slug) {
          opt.setDefault(true);
        }
        return opt;
      });

      selectMenu.addOptions(options);
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
      );
    }

    // Buttons Row
    const hasSelection = Boolean(selectedLink);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CREATE_BTN)
        .setLabel("새 링크 생성")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          hasSelection && selectedSlug
            ? `${CustomId.DASHBOARD_EDIT_BTN}:${selectedSlug}`
            : CustomId.DASHBOARD_EDIT_BTN
        )
        .setLabel("수정")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasSelection),
      new ButtonBuilder()
        .setCustomId(
          hasSelection && selectedSlug
            ? `${CustomId.DASHBOARD_DELETE_BTN}:${selectedSlug}`
            : CustomId.DASHBOARD_DELETE_BTN
        )
        .setLabel("삭제")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasSelection),
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_REFRESH_BTN)
        .setLabel("새로고침")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary)
    );

    components.push(buttonRow);

    return { embeds, components };
  },

  /**
   * Creates a modern card for a newly created or viewed link.
   */
  createLinkCard(link: SinkLink): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const fullShortUrl = sinkClient.getFullShortUrl(link.slug);

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🔗 단축 링크: /${link.slug}`)
      .setURL(fullShortUrl)
      .setDescription(
        `**단축 URL:** [${fullShortUrl}](${fullShortUrl})\n**원본 URL:** ${link.url}`
      )
      .addFields(
        {
          name: "🏷️ 태그",
          value: link.tag ? `\`#${link.tag}\`` : "*없음*",
          inline: true,
        },
        {
          name: "🔒 비밀번호",
          value: link.password ? "설정됨" : "없음",
          inline: true,
        },
        {
          name: "⏳ 만료일",
          value: link.expiration
            ? `<t:${Math.floor(new Date(link.expiration).getTime() / 1000)}:R>`
            : "무제한",
          inline: true,
        }
      )
      .setFooter({ text: "Snipsik • URL Shortener" })
      .setTimestamp();

    if (link.title) {
      embed.setAuthor({ name: link.title });
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("링크 바로가기")
        .setStyle(ButtonStyle.Link)
        .setURL(fullShortUrl)
    );

    return { embeds: [embed], components: [buttonRow] };
  },

  /**
   * Creates a detailed statistics view for a slug.
   */
  createStatsCard(stats: SinkStats): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const fullShortUrl = sinkClient.getFullShortUrl(stats.slug);

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(`📊 링크 통계: /${stats.slug}`)
      .setURL(fullShortUrl)
      .setDescription(`**단축 URL:** [${fullShortUrl}](${fullShortUrl})\n**원본 타겟:** ${stats.url}`)
      .addFields(
        {
          name: "🖱️ 총 클릭 수",
          value: `\`${stats.clicks.toLocaleString()}\` 회`,
          inline: true,
        },
        {
          name: "⏱️ 마지막 클릭",
          value: stats.lastClickedAt
            ? `<t:${Math.floor(new Date(stats.lastClickedAt).getTime() / 1000)}:R>`
            : "*클릭 기록 없음*",
          inline: true,
        }
      )
      .setFooter({ text: "Snipsik • Realtime Analytics" })
      .setTimestamp();

    if (stats.devices && Object.keys(stats.devices).length > 0) {
      const deviceStr = Object.entries(stats.devices)
        .map(([dev, count]) => `• **${dev}**: \`${count}\``)
        .join("\n");
      embed.addFields({ name: "📱 디바이스", value: deviceStr, inline: false });
    }

    if (stats.countries && Object.keys(stats.countries).length > 0) {
      const countryStr = Object.entries(stats.countries)
        .slice(0, 5)
        .map(([c, count]) => `• **${c}**: \`${count}\``)
        .join("\n");
      embed.addFields({ name: "🌍 상위 국가", value: countryStr, inline: true });
    }

    if (stats.referrers && Object.keys(stats.referrers).length > 0) {
      const refStr = Object.entries(stats.referrers)
        .slice(0, 5)
        .map(([ref, count]) => `• **${ref}**: \`${count}\``)
        .join("\n");
      embed.addFields({ name: "🌐 유입 경로", value: refStr, inline: true });
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("링크 열기")
        .setStyle(ButtonStyle.Link)
        .setURL(fullShortUrl)
    );

    return { embeds: [embed], components: [buttonRow] };
  },

  /**
   * Creates a card for DM notifications sent when watching channels.
   */
  createWatchDmCard(
    originalUrl: string,
    shortenedUrl: string,
    guildName: string,
    channelName: string
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle("✂️ 긴 URL이 자동으로 단축되었습니다!")
      .setDescription(
        `**서버:** \`${guildName}\`\n**채널:** \`#${channelName}\`\n\n**원본 링크:**\n${originalUrl}\n\n**단축된 링크:**\n[${shortenedUrl}](${shortenedUrl})`
      )
      .setFooter({ text: "아래 메시지에서 단축 URL만 빠르게 길게 터치하여 복사할 수 있습니다." })
      .setTimestamp();
  },

  /**
   * Creates standard success message embed.
   */
  createSuccessMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Creates standard error message embed.
   */
  createErrorMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Creates standard warning/info message embed.
   */
  createInfoMessage(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`ℹ️ ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Creates a confirmation dialog for deleting a link.
   */
  createDeleteConfirmView(slug: string): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    const embed = new EmbedBuilder()
      .setColor(COLORS.DANGER)
      .setTitle("⚠️ 링크 영구 삭제 확인")
      .setDescription(
        `정말로 단축 링크 \`/${slug}\`을(를) 삭제하시겠습니까?\n삭제된 링크는 복구할 수 없으며 기존 공유된 연결이 끊어집니다.`
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CustomId.DASHBOARD_CONFIRM_DELETE_BTN}:${slug}`)
        .setLabel("삭제 확인")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
      new ButtonBuilder()
        .setCustomId(CustomId.DASHBOARD_CANCEL_DELETE_BTN)
        .setLabel("취소")
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
  },
};
