<!--
  📌 PR 작성 안내 / Pull Request Notice
  1. PR 제목은 영문 Conventional Commits 형식으로 작성해 주세요.
     (PR Title MUST be in English using Conventional Commits, e.g., feat(sink): add tag normalization)
  2. PR 본문(Body)은 한국어로 작성해 주세요.
     (PR Body MUST be written in Korean.)
-->

## 📌 변경 개요 (Overview)

<!-- 이 PR에서 변경하거나 추가한 내용을 간략하게 설명해 주세요. -->

## 🔗 관련 이슈 (Related Issues)

<!-- 연관된 이슈 번호를 연결해 주세요. (예: Resolves #123, Fixes #456) -->

- Resolves #

## 🛠️ 주요 변경점 (Key Changes)

<!-- 주요 코드 수정 사항이나 추가된 기능을 항목별로 작성해 주세요. -->

-

## ✅ 사전 검증 체크리스트 (Verification Checklist)

PR을 제출하기 전 로컬 환경에서 아래 항목을 모두 확인하셨나요?

- [ ] `bun run check` (Biome 린트 및 포맷 검사 통과)
- [ ] `bun run typecheck` (TypeScript 타입 검사 통과)
- [ ] `bun test` (전체 단위 테스트 통과)
- [ ] `bun run build` (번들 빌드 정상 생성 확인)
- [ ] _(DB 스키마 변경 시)_ `src/db/schemaCompatibility.ts` 버전 호환성 검사 및 롤백 호환 마이그레이션 적용 여부 확인
- [ ] PR 제목이 영문 Conventional Commits 형식인가요? (예: `feat(...)`, `fix(...)`, `docs(...)`)
- [ ] PR 본문이 한국어로 작성되었나요?

## 📸 스크린샷 또는 테스트 로그 (Screenshots / Logs)

<!-- Discord UI 변경, CLI 출력 로그, 또는 테스트 결과 캡처가 있다면 첨부해 주세요. (선택 사항) -->
