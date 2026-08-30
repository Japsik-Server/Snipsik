import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { CustomId } from "@/types/bot";
import type { SinkLink } from "@/types/sink";

export function createLinkModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(CustomId.MODAL_CREATE_LINK)
    .setTitle("새 단축 링크 생성");

  const urlInput = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("타겟 URL (필수)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://example.com/very-long-url")
    .setRequired(true);

  const expirationInput = new TextInputBuilder()
    .setCustomId("expiration")
    .setLabel("만료 기간 (선택, 예: 10m, 1h, 7d)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: 1h, 24h, 7d (비워두면 무제한)")
    .setRequired(false);

  const passwordInput = new TextInputBuilder()
    .setCustomId("password")
    .setLabel("비밀번호 보호 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("비밀번호 설정 시 접속 시 요구됨")
    .setRequired(false);

  const tagInput = new TextInputBuilder()
    .setCustomId("tag")
    .setLabel("태그 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: github, docs, event")
    .setRequired(false);

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("링크 제목 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("링크에 표시할 제목")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(expirationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput)
  );

  return modal;
}

export function createEditLinkModal(link: SinkLink): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CustomId.MODAL_EDIT_LINK}:${link.slug}`)
    .setTitle(`링크 수정 (/${link.slug})`);

  const urlInput = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("타겟 URL (필수)")
    .setStyle(TextInputStyle.Short)
    .setValue(link.url)
    .setRequired(true);

  const passwordInput = new TextInputBuilder()
    .setCustomId("password")
    .setLabel("비밀번호 (비워두면 유지)")
    .setStyle(TextInputStyle.Short)
    .setValue(link.password || "")
    .setPlaceholder("새 비밀번호 입력 또는 비워두기")
    .setRequired(false);

  const tagInput = new TextInputBuilder()
    .setCustomId("tag")
    .setLabel("태그")
    .setStyle(TextInputStyle.Short)
    .setValue(link.tag || "")
    .setPlaceholder("태그 수정")
    .setRequired(false);

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("링크 제목")
    .setStyle(TextInputStyle.Short)
    .setValue(link.title || "")
    .setPlaceholder("링크 제목")
    .setRequired(false);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("설명")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(link.description || "")
    .setPlaceholder("링크에 대한 부가 설명")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
  );

  return modal;
}
