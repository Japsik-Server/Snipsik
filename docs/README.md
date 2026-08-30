# Snipsik Documentation

Snipsik은 Cloudflare 기반 오픈소스 링크 단축기인 **Sink([Japsik-Server/Sink](https://github.com/Japsik-Server/Sink))**와 연동하여 동작하는 **Bun + TypeScript** 기반의 Discord 봇입니다.

---

## 📚 문서 목차

1. **[상세 사양서 (Specification)](./SPECIFICATION.md)**
   - 프로젝트 요구사항 및 핵심 원칙
   - 슬러그(Slug) 생성 및 유저 분리 엔진
   - 슬래시 커맨드(`/link`, `/watch`) 상세 명세
   - 개인 전용 대시보드 인터랙션 흐름
   - 채널 감시(Watcher) 및 DM 발송 규격
   - 데이터베이스 스키마 (Supabase + Drizzle ORM)

2. **[시스템 아키텍처 & 배포 가이드 (Architecture & Deployment)](./ARCHITECTURE.md)**
   - 시스템 구성도 및 데이터 흐름
   - 디렉토리 구조 및 절대 경로(`@/*`) 규칙
   - 환경 변수 레퍼런스
   - Docker (`oven/bun:1-alpine`) 및 Docker Compose 배포 가이드

---

## ⚡ 핵심 기능 요약

- **100% Discord Components v2 전면 적용**: 모든 명령어 응답, 대시보드, DM에 레거시 임베드 대신 최신 Components v2 적용.
- **초경량 유저 해시 슬러그**: 별도 링크 DB 없이 슬러그의 유저 해시(CRC32 -> Base62)를 통해 소유권을 O(1)로 식별 (`{랜덤N자리}-{유저해시}`).
- **커스텀 슬러그 권한 제어**: `.env`의 `ADMIN_USER_IDS`에 지정된 유저만 `/link custom` 생성 허용.
- **유저 개인 전용 일시성(Ephemeral) 대시보드**: 개인 링크 통계 요약, 모달 팝업을 통한 생성/수정, 드롭다운 기반 관리.
- **채널 감시 & 모바일 최적화 DM**: 감시 채널에서 긴 URL 감지 시 자동 단축 후 원본 카드와 복사용 순수 Plain URL 발송.
- **Strict TypeScript & Bun 런타임**: `any` 타입 배제, 엄격한 Strict Mode, `@/*` 절대 경로 import.
