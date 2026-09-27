# 🤝 Snipsik 기여 가이드 (Contributing Guidelines)

English follows Korean. / 한국어 안내 후 영문 안내가 이어집니다.

---

## 🇰🇷 한국어 가이드

Snipsik 프로젝트에 관심을 가져주셔서 감사합니다! 버그 수정, 새 기능 제안, 문서 보완 등 여러분의 모든 기여를 환영합니다. 원활한 협업을 위해 아래 가이드라인을 확인해 주시기 바랍니다.

### 🌐 1. 언어 정책 (Language Policy)

Snipsik은 일관된 히스토리 관리와 원활한 커뮤니케이션을 위해 영역별 언어 규칙을 명확히 정하고 있습니다.

| 영역                   | 작성 언어                     | 예시 / 규칙                                           |
| :--------------------- | :---------------------------- | :---------------------------------------------------- |
| **Commit Message**     | **영어 고정 (English only)**  | `feat(sink): normalize custom tags input`             |
| **Issue (이슈 본문)**  | **한국어 고정 (Korean only)** | 버그 제보, 기능 제안 본문은 한국어로 작성             |
| **PR Title (PR 제목)** | **영어 고정 (English only)**  | `fix(deploy): gate rollout on schema compatibility`   |
| **PR Body (PR 본문)**  | **한국어 고정 (Korean only)** | 변경 내용, 검증 항목, 배경 설명은 한국어로 작성       |
| **코드 주석 및 문서**  | **한국어/영어 병기 권장**     | 핵심 정책이나 복잡한 비즈니스 로직은 명확한 서술 권장 |

---

### 🌿 2. Git 워크플로우 (Fork & PR Model)

모든 기여자(조직원 및 외부 기여자)는 **Fork & Pull Request** 모델을 따릅니다.

1. **저장소 Fork**: 상위 리포지토리(`https://github.com/Japsik-Server/Snipsik`)를 본인 계정으로 Fork합니다.
2. **로컬 Clone 및 Upstream 설정**:
   ```bash
   git clone git@github.com:<your-username>/Snipsik.git
   cd Snipsik
   git remote add upstream https://github.com/Japsik-Server/Snipsik.git
   git fetch upstream
   ```
3. **토픽 브랜치 생성**: 항상 최신 `upstream/main`에서 새 브랜치를 분기합니다.
   ```bash
   git checkout -b <prefix>/<feature-name> upstream/main
   ```
   - 브랜치 접두사:
     - `feat/`: 새로운 기능 추가
     - `fix/`: 버그 수정
     - `docs/`: 문서 작성 및 수정
     - `chore/`: 빌드 설정, 의존성 패키지 관리, 보조 도구 수정
     - `refactor/`: 기능 변경 없는 코드 구조 개선
4. **커밋 작성**: [Conventional Commits](https://www.conventionalcommits.org/) 규격을 준수하여 **영문**으로 작성합니다.
   ```
   <type>(<scope>): <short summary in English>

   [선택사항: 상세 설명 본문]
   ```
   - 예: `feat(watch): support thread auto-shortening`, `fix(config): validate minimum url length`
5. **PR 제출**: 본인 Fork 저장소에 푸시한 후, `upstream/main` 브랜치를 타깃으로 PR을 생성합니다.
   - PR 제목은 영문 Conventional Commits로 작성
   - PR 본문은 `.github/PULL_REQUEST_TEMPLATE.md` 서식에 맞춰 한국어로 작성

---

### 💻 3. 로컬 개발 환경 설정 (Local Setup)

- **사전 요구사항**: [Bun](https://bun.sh/) (v1.x 이상)

```bash
# 1. 의존성 설치
bun install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일에 필요한 테스트용 값 입력

# 3. 로컬 데이터베이스 마이그레이션 (필요 시)
bun run db:migrate

# 4. 개발 서버 실행 (핫 리로드)
bun run dev
```

---

### ✅ 4. 사전 검증 체크리스트 (Pre-PR Verification)

PR을 제출하기 전, 로컬에서 아래 **4대 필수 검증 명령어**를 반드시 통과해야 합니다.

```bash
# 1. 코드 린트 및 포맷 검사
bun run check

# (자동 수정이 필요한 경우)
bun run format
bun run lint

# 2. TypeScript 타입 검사
bun run typecheck

# 3. 단위 테스트 전체 실행
bun test

# 4. 번들 빌드 검증
bun run build
```

> ⚠️ **DB 스키마 변경 시 주의사항**:
> 스키마를 변경하거나 마이그레이션을 추가하는 경우, `src/db/schemaCompatibility.ts`의 요구 스키마 버전과 검사 컬럼을 반드시 함께 갱신해야 합니다. 롤백 호환 마이그레이션이어야 하며, 검증 테스트(`test/deploymentReadiness.test.ts`)가 통과하는지 확인하세요.

---

### 🎨 5. 코드 스타일 및 린트 (Code Style)

코드 포맷팅과 린트는 저장소에 구성된 `biome.json` 설정을 따릅니다. PR 전 `bun run format` 및 `bun run check`를 실행하면 자동으로 스타일이 맞춰지므로 수동으로 서식을 맞출 필요가 없습니다.

- **Strict TypeScript**: `any` 타입 사용을 지양하고, 런타임 입력값은 Zod 스키마를 통해 검증합니다.

---

### 🤖 6. AI 코드 리뷰어 안내 (Kodus / Kody AI)

Snipsik 저장소에는 코드 품질 향상을 돕는 AI 리뷰 봇(**Kodus**)이 연동되어 있습니다.

- PR이 등록되거나 변경 사항이 푸시되면 AI 리뷰 봇이 자동으로 변경점을 분석하여 피드백을 남길 수 있습니다.
- `@kody review`와 같은 수동 리뷰 호출 커맨드는 **Organization Member(조직원)만 실행 가능**합니다.
- 외부 기여자의 경우 별도 커맨드를 호출하지 않아도 메인테이너가 리뷰를 진행하거나 봇을 트리거하므로 기다려 주시면 됩니다.

---

### 🔒 7. 보안 취약점 제보

보안 취약점은 공개 이슈로 등록하지 마시고, [SECURITY.md](./SECURITY.md)를 참고하여 GitHub **Private Vulnerability Reporting**을 통해 비공개로 제보해 주세요.

---

---

## 🇺🇸 English Guide

Thank you for your interest in contributing to Snipsik! We welcome bug fixes, new features, and documentation improvements. Please review the guidelines below to ensure a smooth collaboration.

### 🌐 1. Language Policy

| Area               | Language Rule    | Example / Note                                      |
| :----------------- | :--------------- | :-------------------------------------------------- |
| **Commit Message** | **English only** | `feat(sink): normalize custom tags input`           |
| **Issue Body**     | **Korean only**  | Please write issue descriptions in Korean           |
| **PR Title**       | **English only** | `fix(deploy): gate rollout on schema compatibility` |
| **PR Body**        | **Korean only**  | Please describe PR changes and details in Korean    |

### 🌿 2. Git Workflow (Fork & PR)

1. Fork `https://github.com/Japsik-Server/Snipsik` to your account.
2. Clone locally and add the upstream remote:
   ```bash
   git remote add upstream https://github.com/Japsik-Server/Snipsik.git
   ```
3. Create a branch from `upstream/main`:
   ```bash
   git checkout -b <prefix>/<branch-name> upstream/main
   ```
4. Write commits in English following [Conventional Commits](https://www.conventionalcommits.org/).
5. Submit a PR targeting `upstream/main`.

### ✅ 3. Pre-PR Checklist

Before opening a PR, ensure all the following checks pass locally:

```bash
bun run check       # Biome lint & format check
bun run typecheck   # TypeScript type check
bun test            # Unit tests
bun run build       # Build bundle check
```

### 🤖 4. AI Code Review (Kodus)

- The repository uses the Kodus AI review bot.
- Note that invoking the review bot via `@kody review` is restricted to **Organization Members only**.
