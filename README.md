# ✂️ Snipsik

**Snipsik**은 Cloudflare 기반 오픈소스 링크 단축기인 **[Sink](https://github.com/Japsik-Server/Sink)**와 연동하여 동작하는 **Bun + TypeScript** 기반의 고성능 Discord 봇입니다.

---

## ✨ 주요 기능

- 🧩 **100% Discord Components v2 레이아웃**: 모든 커맨드 응답, 대시보드, DM에 모던 인터랙티브 컴포넌트 적용
- ⚡ **초경량 유저 해시 슬러그**: 별도 링크 DB 저장 없이 슬러그의 CRC32 -> Base36 유저 해시로 O(1) 소유권 식별 (`{랜덤N자리}-{유저해시}`)
- 👑 **커스텀 슬러그 권한 제어**: `ADMIN_USER_IDS`에 지정된 관리자만 `/link custom` 생성 허용
- 📊 **유저 개인 전용 일시성(Ephemeral) 대시보드**: 누적 클릭 통계 요약, 링크 선택 드롭다운, Modal 팝업 생성/수정, 삭제 확인
- 👁️ **채널 감시(Watcher) & 모바일 최적화 DM**: 감시 채널에서 긴 URL 감지 시 자동 단축 후 1차 UI 카드 및 2차 원터치 복사용 순수 Plain URL 전송
- 🐦 **Twitter/X fixupx 자동 변환**: 감시 채널 내 twitter.com / x.com 상태 링크를 Discord 임베드에 최적화된 fixupx.com 링크로 자동 변환 (유저별 on/off 지원)
- 🛡️ **Strict TypeScript, Turso & 보안 강화**: `any` 타입 배제, Turso(LibSQL) + Drizzle ORM 설정 저장, KeyedMutex & OCC 동시성 제어 및 SSRF 방어

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1. 사전 요구사항

- [Bun](https://bun.sh/) (v1.x 이상)
- [Turso](https://turso.tech/) (LibSQL) 데이터베이스 (또는 로컬 SQLite)
- [Sink](https://github.com/Japsik-Server/Sink) 인스턴스 및 API 토큰 (`NUXT_SITE_TOKEN`)
- Discord Bot 토큰 및 클라이언트 ID

### 2. 설치 및 환경 변수 설정

```bash
# 의존성 설치
bun install

# 환경 변수 파일 생성
cp .env.example .env
```

`.env` 파일에 필요한 값들을 입력합니다:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DATABASE_URL=libsql://your-database-org.turso.io
DATABASE_AUTH_TOKEN=your_turso_auth_token
SINK_BASE_URL=https://s.japsik.com
SINK_API_TOKEN=your_sink_token
SINK_REQUEST_TIMEOUT_MS=10000
RANDOM_SLUG_LENGTH=3
ADMIN_USER_IDS=294123456789012345
AUTO_SHORTEN_MIN_URL_LENGTH=70
IGNORED_DOMAINS=tenor.com,giphy.com
```

### 3. 데이터베이스 마이그레이션

```bash
bun run db:migrate
```

새 데이터베이스는 체크인된 Drizzle 마이그레이션을 적용합니다. 기존 Turso 설치에서 이미
`db:push`로 만든 초기 스키마는 다시 초기 마이그레이션을 실행하지 마세요. 배포 전 검사는
현재 코드가 요구하는 스키마 버전(`src/db/schemaCompatibility.ts`)의 필수 테이블과
컬럼을 실제 DB에서 확인합니다. 버전 1은 기존 초기 스키마의 구조로 판정하므로
별도 데이터 변경이 필요하지 않습니다. 이후 스키마 변경은 롤백 호환 마이그레이션을
먼저 적용하고, 요구 버전과 검사 항목을 함께 갱신하세요. 배포 과정은 `db:push`를
자동 실행하지 않으며, 검사에 실패하면 기존 봇을 중단하기 전에 배포가 실패합니다.

기존 PostgreSQL에서 Turso로 데이터를 이전해야 하는 경우:

```bash
# 사전 검증 (Dry-run)
SOURCE_PG_URL="postgresql://..." TARGET_TURSO_URL="libsql://..." TARGET_TURSO_AUTH_TOKEN="..." bun run db:transfer --dry-run

# 실제 이전 (타깃 DB가 비어있는 상태)
SOURCE_PG_URL="postgresql://..." TARGET_TURSO_URL="libsql://..." TARGET_TURSO_AUTH_TOKEN="..." bun run db:transfer

# 타깃 DB에 이미 데이터가 있을 때 덮어쓰기 허용 (안전 가드 해제)
SOURCE_PG_URL="postgresql://..." TARGET_TURSO_URL="libsql://..." TARGET_TURSO_AUTH_TOKEN="..." bun run db:transfer --force
```

### 4. 봇 실행

```bash
# 개발 모드 (핫 리로드)
bun run dev

# 프로덕션 실행
bun run start
```

### 5. 테스트 및 빌드 검증

```bash
# 단위 테스트 실행
bun test

# 타입 검사
bun run typecheck

# 번들 빌드
bun run build
```

---

## 🐳 Docker 배포

```bash
# Docker Compose 백그라운드 빌드 및 실행
docker compose up -d --build

# 로그 확인
docker compose logs -f snipsik
```

---

## 📖 문서

- **[상세 사양서 (Specification)](./docs/SPECIFICATION.md)**
- **[시스템 아키텍처 & 배포 가이드 (Architecture & Deployment)](./docs/ARCHITECTURE.md)**

---

## 📄 라이선스

MIT License.
