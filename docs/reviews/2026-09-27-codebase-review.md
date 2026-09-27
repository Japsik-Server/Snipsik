# Snipsik 코드베이스 리뷰 — 2026-09-27

## 1. 목적과 범위

2026-09-17 리뷰(기준 커밋 `4706982e`) 이후 반영된 변경과 아직 남은 문제를 함께 기록합니다. 이번 문서는 **이전 리뷰의 확정 판정 재검증**과 **신규 발견 항목**을 분리해 담으며, 새로운 기능 사양이나 수정 완료 보고서가 아닙니다.

- **검토 기준 커밋:** `b04b9a26dc5989b7fa97f9116d610ac63eacb593` (`main`, 작업 트리 clean)
- **이전 리뷰 기준 커밋:** `4706982e168d2e9d4de93df1a7fd034f35b0f54a`
- **검토 영역:** 커맨드·UI·인터랙션, Sink·HTTP 외부 경계, 서비스·DB·캐시·동시성, 메시지 파이프라인, CI·배포·마이그레이션, 테스트·문서 정합성
- **검토 방식:** 영역별 읽기 전용 서브에이전트 6개의 병렬 리뷰 + 메인 세션의 기준 명령 실행 + 최고 심도 항목의 직접 재현
- **독자:** 봇 기능과 배포를 유지보수하는 개발자
- **제외 범위:** 실제 Discord/Sink/운영 DB 연동, 운영 네트워크 요청을 통한 재현, 배포 실행, 소스 수정

아래 코드 위치와 판단은 **검토 기준 커밋의 스냅샷**입니다. 이후 수정에서는 라인 번호뿐 아니라 해당 함수와 데이터 흐름을 다시 확인해야 합니다.

### 판정 및 우선순위

- **확인:** 코드의 분기·호출 순서 또는 직접 실행으로 실패 조건을 재현했습니다. 운영에서 실제 발생했다는 의미는 아닙니다.
- **조건부:** 특정 외부 API 응답이나 운영 환경에서 발생할 수 있으며, 해당 환경은 확인하지 않았습니다.
- **개선:** 현재 결함으로 단정하지 않지만 안정성·유지보수성을 높일 수 있는 항목입니다.
- **높음:** 권한 경계 또는 핵심 기능의 실패에 직접 영향을 주어 우선 수정할 항목입니다.
- **중간:** 특정 입력·지연·장애·데이터 규모에서 동작이 잘못되는 항목입니다.
- **낮음:** 제한적인 엣지 케이스 또는 예방적 개선입니다.

**직접 재현** 표시가 붙은 항목은 리뷰 에이전트가 아니라 메인 세션이 별도 실행으로 확인한 것입니다. 작성 시점에 모든 항목은 **미해결** 또는 **추가 확인 필요**입니다. 권장 수정은 아직 구현하지 않았습니다.

## 2. 핵심 요약

이전 리뷰가 지적한 19개 항목 중 12개는 실제로 수정되었고 회귀 테스트까지 추가되었습니다. SSRF 방어(R01), Sink 타임아웃(R13), 컨테이너 교체 복구(R17)는 이전 권고의 형태 그대로 구현되어 있습니다. 반면 **권한 식별(R02)은 여전히 미해결이며 오히려 severity가 올라갔습니다** — CRC32 해시 충돌이 실제로 재현되어 교차 사용자 링크 삭제가 성립합니다.

이번 리뷰의 신규 발견 중 가장 무거운 것은 세 가지입니다. 첫째, **테스트 스위트가 운영 DB에 접근할 수 있는 상태**입니다(R02). 둘째, **레거시 DB에서 Watch 등록이 SQL 오류로 전량 실패**하는 상태입니다(R04). 셋째, **검증 단계가 전혀 없는 배포 파이프라인**입니다(R05). 이 셋은 서로를 가리키며, 앞의 둘을 놓친 채 "278개 테스트 통과"를 근거로 한 상태가 세 번째 때문에 자동화되지 않습니다.

| ID  | 우선순위 | 항목                                           | 판정                               | 상태           |
| --- | -------- | ---------------------------------------------- | ---------------------------------- | -------------- |
| R01 | 높음     | CRC32 소유권 해시 충돌로 교차 사용자 링크 접근 | 확인; 재현·pairs 직접 산출         | 미해결         |
| R02 | 높음     | 테스트 스위트가 운영 DB에 접근 가능            | 확인; 로컬 .env 노출 여부는 미확인 | 미해결         |
| R03 | 높음     | Watch 추가·삭제에 뮤텍스와 버전 검사 부재      | 확인                               | 미해결         |
| R04 | 높음     | 레거시 DB에서 Watch INSERT가 SQL 오류로 실패   | 확인; SQLite로 직접 재현           | 미해결         |
| R05 | 높음     | 검증 단계 없는 배포 파이프라인                 | 확인                               | 미해결         |
| R06 | 높음     | 치환 본문 재구성이 다른 URL을 손상             | 확인; 재현                         | 미해결         |
| R07 | 높음     | 설정 패널이 메시지 전체 텍스트 예산 초과       | 확인; 재현                         | 미해결         |
| R08 | 높음     | 긴 제목이 대시보드 렌더링을 중단시킴           | 확인; 재현                         | 미해결         |
| R09 | 높음     | `/link custom`이 관리 불가 링크를 생성         | 확인; 재현                         | 미해결         |
| R10 | 높음     | 서드파티 오류 원문이 Discord 메시지로 노출     | 확인; 재현                         | 미해결         |
| R11 | 높음     | 스포일러 상태가 URL 간에 누출                  | 확인; 재현                         | 미해결         |
| R12 | 높음     | URL 끝 문장부호가 목적지에 포함                | 확인; 재현                         | 미해결         |
| R13 | 중간     | 마이그레이션이 건수 불일치 없이 SUCCESS 보고   | 확인                               | 미해결         |
| R14 | 중간     | 링크 1,000건 정확히에서 대시보드 실패          | 확인; 재현                         | 미해결         |
| R15 | 중간     | 헬스체크가 liveness와 readiness를 혼동         | 확인                               | 미해결         |
| R16 | 중간     | 클릭 수가 Infinity·음수를 측정값으로 수용      | 확인; 재현                         | 미해결         |
| R17 | 중간     | 캐시 주기적 재적재와 Sink 준비 확인 부재       | 확인                               | 미해결         |
| R18 | 중간     | `tsconfig`가 `test/`를 제외해 33개 억제 무효   | 확인                               | 미해결         |
| R19 | 중간     | `chunkText` 경계 손실과 URL 분할               | 확인; 재현                         | 미해결         |
| R20 | 중간     | 슬러그 충돌에 재시도·구분이 없음               | 확인                               | 미해결         |
| R21 | 중간     | NAT64·6to4 IPv6 접두사가 SSRF 차단을 우회      | 확인; 재현(환경 의존)              | 미해결         |
| R22 | 중간     | Watch 캐시 전체 로드 무제한                    | 확인                               | 미해결         |
| R23 | 중간     | `/link check`에 쿨다운·인증 게이트 부재        | 확인                               | 미해결         |
| R24 | 중간     | `cleanExtractedUrl`이 죽은 코드로 남아 있음    | 확인                               | 미해결         |
| R25 | 중간     | 베이스 이미지가 floating tag                   | 확인                               | 미해결         |
| R26 | 중간     | 배포 전 VM 상태 확인이 fail-open               | 확인                               | 미해결         |
| R27 | 중간     | 삭제 버튼 custom-id가 zod 검증 없이 파싱       | 확인; 현재는 권한 검사로 차단      | 미해결         |
| C01 | 중간     | 로컬 .env의 실제 DATABASE_URL 값               | 로컬 확인 필요(비밀값이라 미확인)  | 추가 확인 필요 |

## 3. 이전 리뷰(2026-09-17) 항목 재검증

이전 문서는 17개 항목(R01–R17)과 2개 외부 계약 항목(C01–C02)을 모두 **미해결**로 기록했습니다. 현재 코드 기준으로 재검증한 결과는 다음과 같습니다. 상태는 문서 서술이 아니라 현재 코드로 확인했습니다.

> **번호 충돌 주의:** 이번 문서의 신규 발견 항목도 `R01`–`R27`을 쓰므로, 이 절의 ID는 모두 **`이전 Rxx`** 로 표기해 구분합니다. 아래 표의 "이전 R02(CRC32)"는 본문 4장의 신규 R01과 같은 결함입니다.

| 이전 ID | 항목                                | 현재 상태        | 근거                                                                                                                                                                                   |
| ------- | ----------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 이전 R01     | URL 헬스체크 요청 대상 제한 부재    | **해결**         | `safeHttp.ts`가 프로토콜 허용, 사설 대역 차단, DNS 해석 후 전체 주소 검사, 소켓 `lookup`에 IP 고정, 리다이렉트 hop별 재검증. 표준 우회 표기(integer·hex·octal·`nip.io`) 모두 차단 확인 |
| 이전 R02     | CRC32를 소유권 식별자로 사용        | **미해결(상향)** | 본문 4장 신규 R01 참조(같은 결함). 충돌 쌍이 실제로 산출됨                                                                                                                                                    |
| 이전 R03     | 버튼 인터랙션 ACK 지연              | **해결**         | `deferUpdate()`가 모든 외부 작업 선행. `test/discordAccuracy.test.ts`가 호출 순서 `['defer','delete','edit']`를 단언. 수정 모달 예외도 스냅샷으로 해소                                 |
| 이전 R04     | Watch 초기 캐시 로드 실패 복구      | **해결**         | `CacheRecoveryController`가 단일 비행·상한 백오프(1/2/4/8/16/30초)·`degraded` 상태 유지. `cacheEpoch` 조정으로 로드 중 변경 보존                                                       |
| 이전 R05     | 배포 준비 완료 판정 불충분          | **해결(잔여)**   | `readinessPolicy.ts`가 Discord 연결·DB `SELECT 1`·3개 캐시 `ready`를 요구하고 15초 만료 healthcheck가 동작. 잔여는 본문 신규 R15·R17                                                             |
| 이전 R06     | 잘못된 만료를 무기한 링크로 처리    | **해결**         | `parseExpiration`이 판별 유니온을 반환하고 3개 호출부가 `invalid`에서 생성 전에 중단. 과거 날짜·오버플로도 거부                                                                        |
| 이전 R07     | 마크다운 조합에서 URL 오추출        | **부분 해결**    | 보고된 4개 조합은 수정·테스트됨. 인접 조합은 여전히 결함 — 본문 신규 R11·R12·R24                                                                                                            |
| 이전 R08     | 긴 설정값이 패널 렌더링을 막음      | **부분 해결**    | 도메인 블록 자체는 3,500자로 제한. **메시지 전체** 예산 미구현 — 아래 R07                                                                                                              |
| 이전 R09     | 빈 필드 삭제 의도 유실              | **해결**         | `buildEditLinkPayload`가 빈 문자열을 명시적으로 직렬화. 비밀번호 '비우면 유지'는 별도 규칙으로 분리                                                                                    |
| 이전 R10     | 대시보드 상한과 통계 불일치         | **대부분 해결**  | `linksComplete`·`clicksComplete` 플래그와 구분된 라벨 도입. `/link admin list`의 1,000건 상한은 잔존                                                                                   |
| 이전 R11     | 조회 상한으로 기존 링크 재사용 누락 | **해결**         | `findOwnedLink`이 cursor 페이지를 최대 20페이지 순회하고 `seenCursors` 가드로 종료. 한계 테스트 존재                                                                                   |
| 이전 R12     | Watch 동시 등록 시 중복 행          | **스키마 해결**  | `0001_*.sql`이 중복 제거 후 UNIQUE 인덱스 생성, 실제 LibSQL로 동시 삽입 검증. 단 정렬 계층 부재(신규 R03)와 레거시 DB 미적용(신규 R04)이 잔존                                                    |
| 이전 R13     | Sink 공통 요청 타임아웃 부재        | **해결**         | 요청마다 `AbortController` + `SINK_REQUEST_TIMEOUT_MS`(1–60초 클램프), `finally`에서 해제. 본문 수신까지 포함. 변경 요청(`createLink`)은 재시도하지 않음                               |
| 이전 R14     | 길드 설정 실패 시 제외 도메인 무시  | **해결**         | `ensureAutomaticProcessingReadiness()`가 3개 캐시 모두를 요구하고 `messageCreate`가 조기 반환. 부분 실패 시나리오 테스트 존재                                                          |
| 이전 R15     | 시크릿 액션이 가변 참조 사용        | **해결**         | `pr-agent.yml` 제거, 잔여 서드파티 액션 전부 커밋 SHA 고정. `pull_request_target`·`workflow_run` 없음                                                                                  |
| 이전 R16     | 자동 배포와 수동 마이그레이션 순서  | **부분 해결**    | 이미지 `checkSchema.js` 프리플라이트를 `dcmd stop` **이전**에 실행. 단 컬럼만 검사하고 마이그레이션 자동 적용은 여전히 없음 — 본문 신규 R04                                                      |
| 이전 R17     | 컨테이너 교체 중 스크립트 중단      | **해결**         | `trap` 기반 복구 + 재실행 시 상태 재구성. 테스트 픽스처가 실제 `kill -KILL`을 주입하고 4개 지점에서 재실행 수렴을 검증                                                                 |
| C01     | 응답 unwrap에서 메타데이터 유실     | **해결**         | `readListMetadata`가 바깥 `total`·`cursor`·`list_complete`를 보존하고 중첩 envelope와 병합                                                                                             |
| C02     | 잘못된 2xx를 정상 링크로 정규화     | **해결**         | 모든 엔드포인트가 스키마를 통과해야 함. 빈 객체·오류 envelope·HTML 응답 모두 거부                                                                                                      |

**Supabase RLS 전제**에 대한 이전 문서의 유보는 그대로 유효합니다. 이번 리뷰도 운영 Data API 설정과 실제 DB 역할을 확인하지 않았으며, RLS 비활성화를 확정 취약점으로 분류하지 않습니다.

## 4. 확인된 문제

### R01. CRC32 소유권 해시 충돌로 교차 사용자 링크 접근

- **위치:** `src/services/slugManager.ts:57–60`, `:96–103`; 게이트 소비 지점 `src/commands/link.ts:757`, `:788`, `src/events/interactionCreate.ts:122`, `:166`, `:187`, `:610`, `src/services/ownedLinkCatalog.ts:128–135`
- **직접 재현:** `crc32("123456789") = cbf43926` 표준 벡터로 구현을 검증한 뒤, 실제 Discord snowflake 형태로 3,000,000개를 생성해 충돌을 찾았습니다. 아래는 서로 다른 사용자이며 `verifyOwnership`가 **양쪽 모두에 true**를 반환합니다.
  - `6691880531988365189` / `7011282454672206006` → 해시 `0smittx`
  - `6977287071923953568` / `6755163883267729042` → 해시 `04fq5en`
  - `6819358063883346663` / `6557032175061731319` → 해시 `0e6f714`
- **문제:** `verifyOwnership`가 `slug.endsWith('-' + crc32(userId))` 비교만을으로 소유권을 판정합니다. `slugManager.ts:53–56`의 주석은 "collision-free, injective"라고 서술하지만, 이는 `toBase36`이 **정수**를 인코딩하는 성질이지 CRC32가 사용자 ID를 일대일로 대응시키는 성질이 아닙니다. 권한 판정에 필요한 성질은 정확히 성립하지 않는 쪽입니다.
- **영향:** 충돌 사용자 B가 A의 슬러그로 `/link delete`·`/link stats`를 통과하고, 대시보드 수정 버튼으로 A의 목적지 URL을 교체할 수 있습니다. bare 해시 형태는 두 사용자에게 동시에 소유됩니다. `collectOwnedLinks`가 상대 링크를 A의 대시보드에 노출하므로 목적지와 클릭 수까지 유출됩니다. 32비트 공간의 생일 역설 경계는 약 77,000명이며, 10,000명 등록 시 약 1.1%, 100,000명 시 약 69%입니다.
- **참고:** libsql(리뷰 에이전트 A)와 UI(리뷰 에이전트 B)가 **서로 다른 충돌 쌍**을 독립적으로 산출했습니다. 두 탐색 모두 실제 snowflake 시간대로 디코딩되는 ID를 사용했습니다.
- **설계 전제:** 소유권을 슬러그 자체에 인코딩하고 **link DB를 두지 않는 것은 의도된 설계입니다.** `SPECIFICATION.md`가 DB를 설정·Watch 저장으로 제한하는 것도 이 선택의 결과입니다. 따라서 `slug -> user_id` 매핑 테이블 도입은 이 설계의 기둥을 뒤집는 변경이며, 아래 권장 수정은 **DB 없이 유지되는 해시 교체안만** 다룹니다.
- **권장 수정:** 해시를 64비트 다이제스트(SHA-256 절단 등)로 교체하고, 여전히 사용자 ID에서 결정적으로 유도되며, 여전히 고정 폭 base36 접미사로 붙습니다. 소유권 판정은 지금처럼 문자열 비교로만 이루어지므로 **link DB는 필요하지 않습니다.** 검증 결과 해시 폭에 대한 하드코딩은 `toBase36`의 `padStart(7)`(`slugManager.ts:36`) 하나뿐이고, `isOwnedSlug`·`verifyOwnership`·`getUserHash`의 모든 소비자는 해시를 불투명 문자열로 취급하며, 해시를 역파싱하는 코드는 없습니다. 13~14자 해시는 `validateCustomSlug`의 64자 상한 안에 들어갑니다.

  |                            | CRC32 (현행) | 64비트 다이제스트 |
  | -------------------------- | ------------ | ----------------- |
  | 생일 역설 경계             | 약 77,000명  | 약 40억명         |
  | 10,000명 등록 시 충돌 확률 | 약 1.1%      | 약 1.4×10⁻¹¹      |
  | link DB 필요               | 아니오       | **아니오**        |

- **남는 설계 한계:** 넓은 해시는 충돌률은 낮추지만 설계 계열 자체를 바꾸지는 않습니다. CRC32는 키가 없으므로(user-id를 아는 공격자는) 피해자의 해시를 오프라인에서 계산해 슬러그를 조작할 수 있습니다. 랜덤 접두사가 3자라 온라인 추측은 1/46,656 수준으로 즉각적 위험은 낮지만, "유효한 소유자 접미사를 추측할 수 없다"는 성질이 필요해진다면 넓은 해시가 아니라 **키드 MAC(HMAC)**이 필요합니다. 이는 더 큰 변경이므로 권장 수정에 포함하지 않고 한계로만 기록합니다.
- **완료 기준:** 알려진 충돌 쌍을 고정한 테스트에서 사용자 B가 사용자 A의 슬러그에 대해 거부되는 것을 검증합니다. `SPECIFICATION.md`의 "DB는 설정·Watch 저장" 제약은 **그대로 유지**됩니다.

### R02. 테스트 스위트가 운영 DB에 접근 가능

- **위치:** `src/config.ts:14–22`, `src/db/index.ts:7–12`, `package.json:19`
- **직접 재확인:** 격리된 `/tmp` 디렉터리에서 `bun test`가 `NODE_ENV=test`를 설정함을 확인했습니다. 저장소에는 `bunfig.toml`이 없어 `preload` 가드가 없습니다. `.env.example:8`은 기본값으로 `DATABASE_URL=libsql://your-database-org.turso.io`를 제시합니다.
- **문제:** test 모드 가드는 URL이 **없거나 레거시 `postgres:`일 때만** `file::memory:`로 전환합니다.

  ```ts
  if (
    process.env.NODE_ENV === "test" &&
    (!val || val.startsWith("postgres:") || val.startsWith("postgresql:"))
  ) {
    return "file::memory:";
  }
  ```

  주석은 "legacy postgres URL이 있으면 격리"라는 의도이지만, 결과적으로 **구형 설정만 격리하고 현행 유효한 Turso URL은 그대로 운영 DB를 가리킵니다.** 가드는 명시된 목적과 반대로 동작합니다.

- **실패 조건:** `@/db`를 전이적으로 import하는 테스트 파일이 `createClient({ url, authToken })`를 모듈 로드 시점에 생성합니다. 현재 테스트는 검증 조기 반환 분기만 덮어 우연히 쓰기가 일어나지 않지만, 이는 작성된 단언의 성질이지 방어가 아닙니다. "setGuildConfig이 저장되고 읽힌다" 유형의 테스트가 추가되는 순간 운영 테이블에 기록됩니다. `test/cacheRecovery.test.ts:137`은 기본 `loadRecords`가 실제 `db.select()`인 `WatchService`를 이미 구성합니다.
- **한계:** 로컬 `.env`의 실제 `DATABASE_URL` 값은 비밀값이라 확인하지 않았습니다. 따라서 **결함 자체는 확정**되나 **이 머신이 이미 운영 DB에 접근했는지는 판정하지 않습니다.** `bun test` 2.09초 소요는 네트워크 I/O가 없었음을 시사하지만 소급 증명이 되지 않으므로, 해당 실행을 신뢰하지 마십시오.
- **권장 수정:** test 모드에서 `DATABASE_URL`을 **무조건 무시**하고 `file::memory:`를 강제합니다. `bunfig.toml`의 `[test] preload`로 `test/setup.ts`를 불러 실제 값이 `file::memory:`가 아니면 실패시키도록 합니다.
- **완료 기준:** 유효한 `libsql://` URL이 설정된 상태에서도 테스트가 메모리 DB를 사용하고, 프로덕션 URL을 관측한 테스트가 즉시 실패합니다.

### R03. Watch 추가·삭제에 뮤텍스와 버전 검사 부재

- **위치:** `src/services/watchService.ts:206–243`(추가), `:248–279`(삭제)
- **문제:** 두 메서드 모두 `keyedMutex.runExclusive`를 취하지 않고 `watch_channels`에는 `version` 컬럼 자체가 없습니다. 즉 아키텍처 문서가 OCC로 보장한다고 선언한 범위에 이 테이블이 포함되지 않습니다. `mutex.ts:8–9`의 주석은 "여러 프로세스·배포 중첩 상황까지" 보장한다고 서술합니다.
- **실패 조건:** 길드 `G`가 채널 `C`를 감시 중일 때 `ChannelDelete`와 `/link watch add`가 동시에 진입합니다. 삭제가 캐시 갱신 전에 읽히면 추가가 `:211–216`에서 "이미 감시 중"으로 조용히 버려집니다. 순서가 반대면 추가가 성공했다고 응답한 뒤 진행 중이던 DELETE가 방금 등록된 행을 제거합니다. 두 경우 모두 사용자에게 실제 결과와 다른 응답이 갑니다. 같은 채널의 동시 추가에서는 둘 다 `:211`을 통과하고, UNIQUE 인덱스가 두 번째를 막지만 `:231`에서 **승자가 만들지 않은 행에 대해** `recordCacheMutation`을 호출해, 승자 트랜잭션이 롤백되면 존재하지 않는 채널이 캐시에 남습니다.
- **권장 수정:** 두 메서드를 `keyedMutex.runExclusive(guildId, ...)`로 감싸고 임계 구역 **내부에서** 존재 여부를 다시 읽습니다. 바깥의 `isWatched` 검사)는 저렴한 조기 거절로만 사용합니다.

### R04. 레거시 DB에서 Watch INSERT가 SQL 오류로 실패

- **위치:** `src/services/watchService.ts:46–48`, `src/db/schemaCompatibility.ts:8–30`, `drizzle/0001_deduplicate_watch_channels_and_add_unique_index.sql:8`
- **직접 재현:** 실제 SQLite 엔진으로 두 경우를 실행했습니다.
  - UNIQUE 인덱스 없음(구형 `db:push` 데이터베이스) → `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
  - 인덱스 있음 → 두 삽입 모두 실행, 행 수 1, 중복 정상 억제
- **문제:** `insertRecord`는 `.onConflictDoNothing({ target: [guildId, channelId] })`를 사용하는데, SQLite는 명시적 conflict target에 대응하는 UNIQUE 인덱스가 없으면 위와 같이 실패합니다. `assertSchemaCompatible`은 `pragma_table_info`로 **컬럼만** 검사하고 `pragma_index_list`는 호출하지 않습니다. `REQUIRED_SCHEMA_VERSION`은 여전히 1입니다.
- **실패 조건:** `f7dee53` 이전 스키마로 만들어진 운영 DB는 모든 컬럼을 갖지만 `watch_channels_guild_id_channel_id_unique`가 없습니다. 프리플라이트가 통과하고 컨테이너가 정상 기동하며(캐시 로드는 SELECT만 사용), 배포는 성공으로 보고되고 이전 이미지가 삭제됩니다. 이후 모든 `/link watch add`가 실패하고 `watchService.ts:236–240`에서 **원문 SQLite 메시지가 관리자에게 그대로 노출**됩니다. R12의 중복 행도 조용히 그대로 남아 있습니다.
- **참고:** DB 리뷰와 인프라 리뷰가 서로 다른 경로에서 같은 결함에 도달했습니다.
- **권장 수정:** `assertSchemaCompatible`에 `pragma_index_list('watch_channels')` 검증을 추가하고 `REQUIRED_SCHEMA_VERSION`을 2로 올립니다. 컬럼 완전하지만 인덱스가 없는 스키마를 거부하는 테스트를 추가합니다. `CONTRIBUTING.md:104`는 이미 이 수동 갱신을 요구하고 있으므로, 이를 자동 검증으로 바꾸는 방향이 자연스럽습니다.
- **완료 기준:** 컬럼은 완전하고 인덱스는 없는 상태에서 프리플라이트가 배포를 차단합니다.

### R05. 검증 단계 없는 배포 파이프라인

- **직접 확인:** `.github/workflows/`에는 `deploy.yml` 하나만 존재하고, 그 안에서 `bun test`·`bun run typecheck`·`bun run check`에 해당하는 단계가 **하나도 없습니다**. 트리거는 `main` push이며 `paths-ignore`에 `test/**`가 명시적으로 들어 있습니다.
- **문제:** 단계 순서는 checkout → WIF 인증 → gcloud → 이미지 캐시 확인 → 빌드/푸시 → env 파싱 → VM 상태 확인 → 배포입니다. `main`에 머지된 커밋은 TypeScript 빌드 오류·린트 오류·테스트 실패와 무관하게 Artifact Registry와 운영 VM으로 직행합니다. `CONTRIBUTING.md:87–101`은 이 세 명령을 **수동** 사전 점검으로 안내하지만 강제되지 않습니다.
- **실패 조건:** 스키마 컬럼명이 바뀐 커밋이 머지되면 새 이미지의 `checkSchema.js`가 **수동으로 관리되는** `REQUIRED_COLUMNS` 리터럴을 읽습니다(R25 참조). 이 목록이 함께 갱신되지 않았으므로 프리플라이트가 통과하고, 컨테이너가 기동한 뒤 실제 DB 읽기가 실패해 롤백됩니다. 롤백은 되지만 결함이 운영까지 도달하며 약 60초 장애 창과 이전 이미지 삭제가 비용입니다.
- **권장 수정:** `pull_request` 트리거로 `bun install --frozen-lockfile && bun run typecheck && bun run check && bun test`를 실행하는 `verify` 잡을 추가하고 배포 잡이 이를 `needs`로 참조하게 합니다. `deploy.yml`의 `paths-ignore`에서 `test/**`를 제거합니다.

### R06. 치환 본문 재구성이 다른 URL을 손상

- **위치:** `src/services/userConfigService.ts:594–597` (호출부 `src/events/messageCreate.ts:488`)
- **직접 확인:** 치환 루프는 다음과 같습니다.

  ```ts
  for (const [origUrl, targetUrl] of sorted) {
    result = result.split(origUrl).join(targetUrl);
  }
  ```

- **문제:** 전체 문자열 `split().join()`이므로, URL A가 URL B의 접두사이고 A만 치환되면 B의 텍스트에는 이미 A의 슬러그가 합쳐진 상태가 됩니다. 길이 내림차순 정렬은 치환 순서만 보호할 뿐, **치환되지 않은 다른 URL 안에서의 오매칭**은 막지 못합니다.
- **실패 조건:** Sink 생성이 2번째 URL에서만 실패하면

  ```
  입력: https://example.com/aaaaaaaaaa https://example.com/aaaaaaaaaa/bbbbbbbbbb
  DM:  https://sink.test/aaa-hash https://sink.test/aaa-hash/bbbbbbbbbb
  ```

  두 번째 링크가 **다른 목적지**를 가리키게 됩니다. 표기 문제가 아니라 잘못된 링크입니다. 부분 실패 경로에서 발현하므로 이미 장애가 난 상황에서 특히 위험합니다.

- **원인 제거 가능성:** `extractUrlsFromDiscordMarkdown`는 이미 `start`·`end` 오프셋을 계산합니다(`messageCreate.ts:88–91` 이후). `src/` 어디에서도 `match.start`·`match.end`를 읽지 않아 **계산 후 폐기되고 있습니다.**
- **권장 수정:** 폐기되고 있는 오프셋으로 겹치지 않는 구간을 한 번 순회해 오른쪽부터 치환합니다. 비-URL 텍스트가 바이트 단위로 동일함을 보장하는 이 방식은 `chunkText`의 손실(R19)도 함께 정리합니다.

### R07. 설정 패널이 메시지 전체 텍스트 예산 초과

- **위치:** `src/utils/ui.ts:767–771`(`createIgnoredDomainsContent` 자체만 3,500자로 제한), notice 경로 `src/commands/link.ts:1670–1674`, `:1901–1904`
- **문제:** Discord Components v2의 4,000자 제한은 **컴포넌트별이 아니라 메시지 전체** 합산입니다. 도메인 블록만 3,500자로 예산을 잡았고, 같은 메시지의 헤더·섹션 설명·푸터와 `ui.ts:596–598`의 notice 블록(`safeDescription`이 독립적으로 3,800자까지 허용)은 합쳐서 계산하지 않습니다. discord.js는 이를 클라이언트에서 검증하지 않아 직렬화는 성공하고 **서버가 HTTP 400을 반환**합니다.
- **실패 조건:** `normalizeDomain`이 253자 도메인을 허용하고(`src/utils/domain.ts:59`) `MAX_CUSTOM_IGNORED_DOMAINS = 50`이므로, 253자짜리 도메인 7개는 검증을 완전히 통과하는 일상 입력입니다. 저장 성공 후 확인 `editReply`가 400으로 실패하고, 바깥 catch가 다시 `editReply`를 시도하다 실패하며, `interactionCreate.ts:786`의 catch가 이를 삼킵니다. **사용자는 아무 피드도 받지 못합니다.** 이후 모든 `/link config`가 같은 패널을 그리므로 설정 UI가 영구히 손상되고 자체 복구 경로가 없습니다.
- **검증:** `/link config key:ignored_domains`에 7개 도메인을 넣으면 총 4,328자, 50개면 7,810자로 확인되었습니다.
- **부분 해결 근거:** 이전 R08의 정확한 재현(3,989자 단일 텍스트)은 이제 통과합니다. 남은 결함은 notice 경로입니다. `test/discordAccuracy.test.ts:350–372`는 `toJSON()`이 예외를 던지지 않는지만 검사하므로 **서버 측 400을 잡을 수 없습니다.**
- **권장 수정:** 메시지 전체 텍스트 예산을 단일 계산하고 `createConfigPanelView`가 이미 렌더링된 컴포넌트에서 잔여 예산을 계산해 전달하게 합니다. 전체 `content` 길이 합이 4,000 이하임을 단언하는 테스트를 추가합니다.

### R08. 긴 제목이 대시보드 렌더링을 중단시킴

- **위치:** `src/utils/ui.ts:274–281`(선택 링크 상세), `:338–344`(`createLinkCard`), `:60–62`(`formatTitleDisplay`)
- **직접 확인:** `formatTitleDisplay`는 공백만 제거하고 길이를 제한하지 않습니다. `normalizeSinkLink`도 `title` 상한을 두지 않으며, 수정 모달(`modals.ts:79–87`)은 4,000자까지 허용합니다. 선택 링크 컨테이너는 3,725자까지 렌더링되고 **3,726자에서 `Invalid string length`**로 예외를 던집니다.
- **실패 조건:** 4,000자 제목으로 링크를 만들면 대시보드에서 해당 링크를 선택하는 순간 예외가 발생합니다. `createDashboardView`는 6개 호출부에서 각각 `try`로 감싸져 있어 사용자는 "인터랙션 처리 오류"를 보고 대시보드를 볼 수 없으며, **수정·삭제 버튼에 도달할 방법이 없어** 링크가 UI에서 고아가 됩니다. 같은 제목은 수정 모달도 깨뜨립니다.
- **권장 수정:** `formatTitleDisplay`를 약 200자로 클램프하고, 저장된 값이 나중에 어떤 경로로도 빌더에 도달하지 못하도록 `normalizeSinkLink` 또는 스키마 단계에서 상한을 둡니다. 긴 제목·설명 렌더링 테스트를 추가합니다.

### R09. `/link custom`이 관리 불가 링크를 생성

- **위치:** `src/commands/link.ts:613–662`, `src/services/slugManager.ts:108–139`(`validateCustomSlug`), `:96–103`(`verifyOwnership`), `src/services/ownedLinkCatalog.ts:128–135`(`isOwnedSlug`)
- **직접 확인:** `validateCustomSlug`은 2–64자 `[a-zA-Z0-9_-]`를 받기만 하고, `verifyOwnership`과 `isOwnedSlug`이 공통으로 요구하는 `{random}-{userHash}` 접미사를 요구하지 않습니다.

  ```
  verifyOwnership("mypromo-campaign", adminId) = false
  collectOwnedLinks(getUserHash(adminId))      →  [ "jfm-0m846q1" ]   // 커스텀 슬러그 제외
  ```

- **실패 조건:** 관리자가 `/link custom url:… custom_slug:summer-sale`을 실행하면 생성 성공 카드가 표시되지만, 링크는 `/link dashboard`와 `/link list`에 **절대 나타나지 않고** `/link delete slug:summer-sale`은 "삭제 권한 없음"으로 거절됩니다. 제거하려면 `/link admin delete` 또는 Sink UI를 통해서만 가능합니다. 정식 커맨드로 만들었다가 관리할 수 없는 링크가 된 것입니다.
- **권장 수정:** `validateCustomSlug`에서 해시 접미사를 요구하거나, 부재 시 자동 추가해 슬러그가 `{random}-{userHash}` 형식을 항상 따르도록 합니다. 그러면 `isOwnedSlug`·`verifyOwnership`이 이미 쓰는 판정 규칙이 그대로 작동하므로 link DB는 여전히 필요하지 않습니다. R01의 해시 교체와 함께 적용하면 두 항목이 같은 변경으로 해소됩니다.

### R10. 서드파티 오류 원문이 Discord 메시지로 노출

- **위치:** `src/services/sinkClient.ts:606–608`, `:613–646`; 노출부 `src/commands/link.ts:566–573`, `:802–807`, `:833–837`, `src/events/interactionCreate.ts:687–694`
- **직접 확인:** JSON이 아닌 비-2xx 응답은 본문 전체가 `{ message: text }`로 감싸지고, `:618–620`이 `record.message`를 상한·이스케이프·필터링 없이 `errorMsg`로 승격합니다. 이 문자열은 verbatim으로 Discord 오류 embed에 삽입됩니다. 저장소 전체에 `allowed_mentions`를 설정하는 코드가 **없습니다.**
- **실패 조건:** 악의적이거나 손상된 Sink가 502와 함께 `@everyone https://discord.gg/aaa …`를 반환하면 그 본문이 그대로 렌더링됩니다. 본문 크기는 `safeDescription`의 3,800자로 제한될 뿐 거부되지 않으므로 공격자가 약 3.8KB의 임의 텍스트를 봇 메시지에 심을 수 있고, non-ephemeral 경로에서는 완전히 제어합니다. 업스트림 프록시·인프라 내부 정보도 함께 노출됩니다.
- **참고:** 같은 계열로 `safeHttp.ts:198`이 업스트림 HTTP reason phrase를 무길이 제한·무문자 필터로 `/link check` 응답에 반영합니다(R23과 동일 커맨드).
- **권장 수정:** 비-2xx를 상태 코드별 고정 사용자 메시지로 매핑하고 원문은 서버 로그에만 남깁니다. `allowed_mentions: { parse: [] }`를 모든 응답에 기본 적용하는 것도 함께 검토합니다.

### R11. 스포일러 상태가 URL 간에 누출

- **위치:** `src/events/messageCreate.ts:32–40`, `:359–407`
- **직접 확인:** `isInsideSpoiler`이 매치 위치 이전의 `||` 개수를 **메시지 전체에서** 셉니다. 앞선 URL의 쿼리에 정당한 `||`가 있으면 이후 모든 URL의 스포일러 상태가 뒤집힙니다.
- **실패 조건:**

  ```
  입력: https://ex.com/a||b https://ex.com/second?q=1||2
  저장: ["https://ex.com/a||b", "https://ex.com/second?q=1"]   ← 두 번째 URL이 잘려 저장됨
  DM:   https://sink.test/sl-hash https://sink.test/sl-hash||2  ← 고아 "||2"
  ```

  두 번째 링크가 **깨진 상태로 저장**되고 DM도 malformed가 됩니다. 합법적인 `|` 쿼리를 보존하는 기존 테스트가 있는 만큼 쿼리 구분자는 실제로 사용됩니다.

- **권장 수정:** 스포일러 판정을 매치 자체로 한정하거나, 최소한 이전에 추출된 URL 구간 안의 구분자는 세지 않도록 `lastUrlEnd`를 추적합니다.

### R12. URL 끝 문장부호가 목적지에 포함

- **위치:** `src/events/messageCreate.ts:57–86`(종결 문자 세트), `URL_TERMINATORS` 정의
- **직접 확인:** 스캐너는 공백과 소수의 종결자에서 멈추지만 끝 문장부호를 제거하지 않습니다. `**굵게**`는 처리되지만 단일 `*`·`__`·`~~`는 처리되지 않고, 종결자 집합에 `'`, `’`, `”`, `!`, `,`, `;`, `:`, `.`과 CJK 문장부호가 없습니다. `new URL()`이 이를 그대로 받아들이므로 하위에서 잡아내지 못합니다.
- **실패 조건:**

  ```
  입력: Please read https://en.wikipedia.org/wiki/Foo_(mathematics). Thanks!
  저장: https://en.wikipedia.org/wiki/Foo_(mathematics).          ← 끝의 "." 포함, 대상 404
  입력: 참고 https://example.com/aaaa…。입니다
  저장: https://example.com/aaaa…。입니다                         ← CJK 본문이 URL에 흡수
  ```

  가장 흔한 입력 형태이며, 5개 `messageCreate*` 테스트는 pipe·제외 도메인·최소 길이·재사용·embed 억제만 다룹니다.

- **파생:** Twitter/X 상태 링크는 `:379–392`의 앵커 정규식(`^…$`)이 이 부호로 실패하고 `:391`의 무음 `continue`로 **fixupx도 단축도 DM도 없이 조용히 누락**됩니다. 문장 끝에 마침표 하나만 붙어도 동작이 완전히 달라집니다.
- **권장 수정:** 종결 문자 집합을 확대하고 숫자 인식형 끝 문장부호 제거 패스를 추가합니다. `:391`의 무음 건너뛰기에 최소한 `logger.debug`를 남깁니다.

## 5. 중간 우선순위 항목

아래 항목은 각 절에서 위치를 표기하며 별도 검증 로그가 없습니다.

| ID  | 항목                                         | 위치 및 요지                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R13 | 마이그레이션이 건수 불일치 없이 SUCCESS 보고 | `scripts/migrate-pg-to-turso.ts:717`에서 `allSucceeded`는 `s.success`(행 단위 내용 검증 플래그)만 평가합니다. `:710–712`는 `sourceCount`와 `targetAfterCount`를 나란히 출력하지만 **비교하지 않습니다.** `DELETE FROM`은 `:325`의 `sqlite_sequence` 수리뿐입니다. 부분 실행 후 `--force` 재실행 시 대상 전용 400행이 남아 `PG 3000 / Turso 3400 / SUCCESS`와 exit 0이 출력됩니다. 원본을 쓰거나 지우는 문장은 없으므로 출처 DB는 보존됩니다. **완료 기준:** `targetAfterCount` 대조 또는 차이가 명시적으로 보고될 것. 봇 중지 선행 절차를 문서화할 것 |
| R14 | 링크 1,000건 정확히에서 대시보드 실패        | `ownedLinkCatalog.ts:196–243`. 완결 추론이 `listComplete === true` 또는 `listComplete === undefined && cursor 없음 && page.length < 1000`이므로, 정확히 1,000건에 `listComplete`가 없으면 미완료로 오인해 `link.ts:66–67`에서 원문 오류로 throw합니다. **999건은 통과하고 1,000건은 실패하고 1,001건은 통과**하는 경계 단일 실패점입니다. cursor 부재를 종료 조건으로 삼으면 해결됩니다                                                                                                                                                               |
| R15 | 헬스체크가 liveness와 readiness를 혼동       | `Dockerfile:25`, `scripts/deploy.sh:92`, `cacheRecovery.ts:106`. 일시적 Turso 오류로 `degraded`가 되면 readiness 파일이 해제되어 컨테이너가 `unhealthy`가 되지만, `--restart unless-stopped`는 **프로세스 종료에만** 반응하므로 unhealthy 봇이 계속 실행됩니다. 알림 경로가 전혀 없어 다음 무관한 push가 처음 발견하는 지점이 됩니다. readiness는 배포 게이트로, healthcheck는 liveness로 분리하는 것이 좋습니다                                                                                                                                      |
| R16 | 클릭 수가 Infinity·음수를 측정값으로 수용    | `sinkClient.ts:104`의 `Number(row.visits)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |     | 0`은 `Infinity`를 통과시킵니다(` |     | 0`은 NaN만 잡음). 단건 경로 `:1202–1206`에는 `Number.isFinite`가드가 있으나 대시보드 벌크 경로에는 없습니다.`{"visits":1e999}`는 `∞회`, `{"visits":-42}`는 `-42회`로 렌더링되고 `analyticsAvailable: true`로 보고됩니다 |
| R17 | 캐시 주기적 재적재와 Sink 준비 확인 부재     | `ready.ts:32`가 `testDbConnection()` 반환값을 버립니다. `isDeploymentReady`는 Sink 도달 가능성을 확인하지 않으며, 3개 캐시는 타이머 재적재가 없습니다(쓰기 경유만). Sink 토큰 회전 시 연결·DB 탐지·캐시가 모두 정상으로 보여 readiness가 무한히 녹색이고 링크 생성만 전부 실패합니다                                                                                                                                                                                                                                                                  |
| R18 | `tsconfig`가 `test/`를 제외                  | `tsconfig.json:32`가 `src/**/*`만 포함합니다. 테스트의 `@ts-expect-error` 33개는 컴파일 대상이 아니어서 **아무것도 억제하고 있지 않으며**, 미사용 `@ts-expect-error`는 오류라는 규칙도 적용되지 않습니다. `test`를 포함하는 `tsconfig.test.json`을 추가하면 33개가 동시에 활성화됩니다                                                                                                                                                                                                                                                                |
| R19 | `chunkText` 경계 손실과 URL 분할             | `userConfigService.ts:605–631`. `:627`의 `replace(/^\n+/, '')`가 개행을 삭제해 `chunks.join('') !== original`입니다(개행을 되돌리면 일치). 2,000자 경계가 URL 중간에 걸리면 링크가 두 DM으로 쪼개지는데, 두 조각 모두 발송에 성공해 `messageCreate.ts:512`는 "성공"을 기록합니다                                                                                                                                                                                                                                                                      |
| R20 | 슬러그 충돌에 재시도·구분이 없음             | `slugManager.ts:86–90`, `messageCreate.ts:276–289`. 기본 `RANDOM_SLUG_LENGTH=3`은 사용자당 36³ = 46,656개 조합이며 `createLink`을 1회만 호출하고 모든 실패를 동일하게 처리합니다. 충돌과 진짜 장애가 구분되지 않아 사용자에게는 아무 신호도 없습니다. 409에 한해 재시도하거나 길이를 5로 상향하는 것을 검토합니다                                                                                                                                                                                                                                     |
| R21 | NAT64·6to4 IPv6 접두사가 SSRF 차단 우회      | `safeHttp.ts:66–88`. IPv6 차단 목록에 `64:ff9b::/96`(NAT64), `2002::/16`(6to4), `64:ff9b:1::/48`가 없고 `::ffff:0:0/96`가 인접 형태 `::7f00:1`을 놓칩니다. `isPublicIpAddress('64:ff9b::a9fe:a9fe') === true`로 확인됩니다. 해당 게이트웨이가 있는 호스트에서 클라우드 메타데이터로 도달할 수 있으나, 일반적인 IPv4 전용 Docker 환경은 영향이 없어 중간으로 분류합니다                                                                                                                                                                                |
| R22 | Watch 캐시 전체 로드 무제한                  | `watchService.ts:39`, `:92–97`. `db.select().from(watchChannels)`에 `LIMIT`과 페이징이 없어 전체 테이블을 메모리에 올립니다. `cacheRecovery.ts:137–158`의 30초 간격 영구 재시도가 동일한 무제한 질의를 반복하며 스트림을 점유합니다. 청크 페이징을 적용합니다                                                                                                                                                                                                                                                                                         |
| R23 | `/link check`에 쿨다운·인증 게이트 부재      | `link.ts:819–840`, `:296–302`. `setDefaultMemberPermissions`가 없고 사용자별 쿨다운도 전역 제한도 없습니다(저장소에 `rate`·`cooldown` 검색 결과 0). 이전 R01의 대상 제한은 해결됐으므로 남은 것은 가용성입니다. 봇 호스트가 공개 인터넷 대상 요청 대행 도구가 되며, 응답 시간과 상태가 사용자에게 노출되어 공개 포트 스캔에 쓰일 수 있습니다                                                                                                                                                                                                               |
| R24 | `cleanExtractedUrl`이 죽은 코드로 남아 있음  | `messageCreate.ts:108`에 정의만 있고 `src/`의 호출부는 **0개**입니다. 실제 정리는 `:57–86`의 while 루프가 담당합니다. 그런데 `test/messageCreatePipeExtraction.test.ts:64–112`의 단위 테스트 6개가 이 함수를 대상으로 통과합니다. 라이브 경로가 실행하지 않는 함수에 대해 정리가 검증된 것처럼 보이게 하는, R24 자체가 대표적 예시인 **거짓 신뢰 테스트**입니다. 함수를 삭제하고 단언을 실제 추출 경로로 옮깁니다                                                                                                                                     |
| R25 | 베이스 이미지가 floating tag                 | `Dockerfile:2, 14`. 두 스테이지 모두 `oven/bun:1-alpine`에 digest가 없습니다. `deploy.yml:71`이 upstream digest를 조회하지만 캐시 키(`BUILD_HASH`)에 염료로만 사용되므로 빌드는 여전히 floating tag가 가리키는 이미지를 받습니다. `REQUIRED_COLUMNS`가 스키마의 수동 중복 사본인 문제(R04·R26)와 함께 별개 결함으로 다룹니다                                                                                                                                                                                                                          |
| R26 | 배포 전 VM 상태 확인이 fail-open             | `deploy.yml:180–185`. SSH 탐지 실패·필드 수 불일치·빈 상태 줄이면 `needs_deploy=true`로 진행합니다("Failing open to deploy"). R17의 복구 경로에서 언급한 SIGKILL 중단 상태가 바로 파싱 불가능 상태를 만들므로, **가장 섬세한 상태가 가장 정보가 적은 분기로** 들어갑니다. `deploy.sh:60–77` 자체 재구성 로직이 실제로는 구원하지만, 전제 조건이 검증되었다는 증거 없이 배포됩니다. `environment:` 승인 게이트도 없습니다                                                                                                                              |
| R27 | 삭제 버튼 custom-id가 zod 없이 파싱          | `interactionCreate.ts:151–154`, `:183–186`. 최근 zod 보강이 `DASHBOARD_EDIT_BTN`과 `MODAL_EDIT_LINK`에는 적용됐으나 두 삭제 경로는 `includes(':')` 참성 검사만 합니다. `customId = "dash:delete_btn:../../etc"`가 그대로 통과합니다. 현재는 `verifyOwnership`이 실패하므로 차단되지만, **가장 위험한 삭제 경로가 유일하게 무검증**이라는 점이 문제입니다. `parseCustomIdSlug`을 4개 경로에 동일하게 적용합니다                                                                                                                                        |

## 6. 추가 확인이 필요한 항목

### C01. 로컬 `.env`의 실제 `DATABASE_URL`

R02에서 결함 자체는 확정했으나, 이 머신의 `.env`가 실제로 유효한 Turso URL을 담고 있는지는 확인하지 않았습니다. 비밀값을 읽는 명령이 권한 거부되어 우회하지 않았습니다. **사용자가 직접 확인해야 하는 항목이며**, 결과에 따라 R02의 노출 범위가 결정됩니다. 값이 `file:` 또는 비어 있으면 현재 실행은 무해했으나 가드는 여전히 그대로입니다.

### Config 상한 누락

`src/config.ts:60–67`의 `RANDOM_SLUG_LENGTH`는 하한만 강제하고(`parsed < 2 ? 3`) **상한이 없습니다.** `docs/ARCHITECTURE.md:112`는 "2~16"으로 서술합니다. 값이 충분히 크면 슬러그 길이가 Discord `customId`의 100자 제한을 넘어 대시보드 렌더링이 예외로 끝나고, Sink 삭제 재검증에 걸려 링크가 **삭제 불가능한 상태**로 남습니다. `z.number().min(2).max(16)`을 문서와 일치시키고, 슬러그가 customId에 들어가기 전 `max(100)`을 강제합니다.

## 7. 의존성 관찰

`bun audit` 결과 직접 의존성 `drizzle-orm@0.39.3`에 [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)(SQL 식별자 이스케이프 부재를 통한 SQL injection, 0.45.2에서 수정)가 보고됩니다. 다만 `src/`와 `scripts/`의 모든 `sql` 템플릿은 **컬럼 참조 객체**만 삽입하고 사용자 입력 문자열을 식별자로 넣지 않으며, `.raw()`이나 문자열 조립 SQL도 없습니다. 발견된 3건은 `schema.ts:53`·`:84`의 정적 CHECK 제약과 `deploymentReadiness.ts:95`의 `SELECT 1`입니다. **즉 이 코드베이스에서는 도달 불가능한 취약점이며, 잠재치로 분류합니다.** 마이그레이션은 여전히 필요합니다. `esbuild` 항목은 `drizzle-kit`의 개발용 전이 의존성입니다.

주요 업데이트 가능 항목: `drizzle-orm` 0.39→0.45, `zod` 3.25→4.6( majors, 마이그레이션 필요), `typescript` 5.9→7.0, `drizzle-kit` 0.30→0.31.

## 8. 후속 작업 체크리스트

### 1단계 — 권한 경계와 데이터 안전

- [ ] R01: 소유권 해시를 64비트 다이제스트로 교체(link DB 없이 유지) 및 충돌 쌍 회귀 테스트
- [ ] R09: 커스텀 슬러그 소유권 기록(R01과 함께 해소)
- [ ] R02: test DB 강제 격리와 `bunfig.toml` preload 가드
- [ ] R04: `pragma_index_list` 검증 추가, `REQUIRED_SCHEMA_VERSION` 상향, 레거시 DB 확인
- [ ] R05: `verify` 잡 추가, `test/**`를 `paths-ignore`에서 제거

### 2단계 — 사용자 대면 출력과 데이터 정확성

- [ ] R07: 메시지 전체 4,000자 예산과 합산 테스트
- [ ] R08: 제목 길이 클램프와 저장 단계 상한
- [ ] R10: 비-2xx 원문 노출 차단, `allowed_mentions` 기본 적용
- [ ] R06, R19: 오프셋 기반 치환으로 문자열 손실 제거
- [ ] R11, R12, R24: URL 경계 정리와 죽은 코드·거짓 신뢰 테스트 제거

### 3단계 — 복구·동시성·운영

- [ ] R03: Watch 쓰기에 뮤텍스와 임계 구역 내 재확인
- [ ] R13: 마이그레이션 건수 대조와 고아 행 보고
- [ ] R14: 1,000건 경계 수정
- [ ] R15, R17: liveness/readiness 분리, Sink 준비 확인, 캐시 주기 재적재
- [ ] R25, R26: 베이스 이미지 digest 고정, 상태 확인 fail-closed
- [ ] R16, R20–R23, R27: 값 검증·재시도·쿨다운·파싱 정합성
- [ ] R18: `tsconfig.test.json` 추가로 테스트 코드 타입 검사

## 9. 검증 기록과 한계

| 수행 주체         | 검증                                                                                      | 결과                                       |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| 메인 세션         | `bun run typecheck`                                                                       | 통과                                       |
| 메인 세션         | `bun run check` (Biome 70파일)                                                            | 통과, 진단 0                               |
| 메인 세션         | `bun test`                                                                                | 278 통과 / 0 실패, 1093 단언, 2.09초       |
| 메인 세션         | `bun audit`                                                                               | 1 high, 1 moderate                         |
| 메인 세션         | CRC32 해시 구현을 `"123456789" -> cbf43926` 표준 벡터로 검증 후 300만 snowflake 충돌 탐색 | 3쌍 충돌 산출, `verifyOwnership` 양쪽 true |
| 메인 세션         | 실제 SQLite로 `ON CONFLICT` 유니크 인덱스 유무 비교                                       | 인덱스 없으면 실패, 있으면 중복 억제 확인  |
| 메인 세션         | 워크플로 목록과 `bun test`·`typecheck`·`check` 단계 검색                                  | 워크플로 1개, 검증 단계 없음               |
| 메인 세션         | `bun test`의 `NODE_ENV=test` 설정 확인(격리 디렉터리)                                     | 설정됨, `bunfig.toml` 없음                 |
| 리뷰 에이전트 6개 | 영역별 읽기 전용 리뷰와 로컬 probe                                                        | 영역별 상세는 각 절에 기재                 |

- **CI 부재:** 저장소에 검증 워크플로가 없어 위 통과 결과는 이 머신의 속성이며 어떤 커밋에도 게이트로 적용되지 않습니다. R05가 이를 다룹니다.
- **테스트 DB 격리 미확인:** `bun test` 실행(R02 대상)을 네트워크 I/O 부재로 보이지만 소급 증명하지 않았습니다. 이 실행 결과를 근거로 판단하지 마십시오.
- **비밀값 미확인:** `.env`의 `DATABASE_URL` 등 비밀값 읽기 명령이 권한 거부되어 확인하지 않았습니다. 우회하지 않았습니다(C01).
- 에이전트별 테스트 범위가 겹치므로 통과 개수를 합산하지 않습니다.
- 기존 테스트 통과는 위 경계 조건이나 운영 연동의 정상 동작을 보장하지 않습니다.
- 실제 Discord/Sink/운영 DB 호출, 내부 네트워크 요청을 통한 보안 문제 재현, 배포 실행은 하지 않았습니다.
- 리뷰 에이전트들이 수행한 probe 스크립트는 모두 임시 파일로 실행 후 삭제되었으며 `git status`는 clean입니다. 저장소 파일 수정·커밋·브랜치 생성은 하지 않았습니다.
- **리뷰 브리프의 오류 정정:** 메시지 파이프라인 영역 브리프는 "메시지 편집 정확성"을 중점 검토하도록 지시했으나, 실제 코드에 `message.edit()` 호출은 **존재하지 않습니다.** 치환 본문은 DM으로만 전달되며, 113건의 `edit*` 일치는 전부 인터랙션 응답(`deferReply`·`editReply`)입니다. 따라서 편집 권한·슬로우 모드·수동 편집·`EMBED_LINKS` 관련 위험 범주는 구조적으로 해당하지 않고, 해당 문구는 R06·R19의 DM 재구성 경로로 대체되었습니다. R24도 브리프가 존재를 전제한 `cleanExtractedUrl`이 실은 죽은 코드였습니다.
- **에이전트 수치 정정:** Sink 에이전트는 적은 탐색 규모 대비 높은 충돌률을 보고했으나, 생일 역설 경계로 계산하면 2³² 공간의 최초 충돌 기대치는 약 77,000명입니다. 본 리뷰의 300만 표본 재현은 이를 뒷받침합니다.
- **소거된 가설:** 첫 CRC32 재현은 표본 격자를 구조화해 0건이 나왔습니다. CRC32는 GF(2) 위의 아핀 변환이므로 일정한 접미사 격자는 유효한 생일 표본이 아니며, 해당 결과는 폐기했습니다.

## 10. 문서 정합성

이전 문서에 없던 항목들입니다.

- `/link watch ignored-domains`가 `docs/SPECIFICATION.md`의 서브커맨드 표(`:50–67`)에 없습니다. 코드는 `link.ts:453`에 `action`·`domain` 옵션으로 정의하고 `guildConfigService`의 전체 `mutateIgnoredDomains` OCC 경로로 라우팅합니다. `docs/ARCHITECTURE.md:86`은 `watch`·`admin`·`ignored-domains`를 모두 누락합니다. 오류 코드는 사람이 읽는 문자가 아닌 센티널(`is_system_default`·`already_exists`·`limit_exceeded` 등)이라 호출부 번역이 필요합니다.
- 길드 단위 제외 도메인 명령과 `mutateIgnoredDomains` 경로에 테스트가 하나도 없습니다(`test/`에서 `addIgnoredDomain`·`removeIgnoredDomain`·`resetIgnoredDomains` 검색 0건). 사용자 단위 동등 기능은 잘 커버되어 있어 비대칭입니다.
- Sink의 `Authorization` 헤더, 5,000개 id 상한, 외부 abort 경로가 단언되지 않았습니다. `test/` 전체에서 `Authorization`·`Bearer` 검색 0건이며 66개 테스트가 모두 요청 **URL**만 검사합니다. 헤더가 유실되는 회귀는 테스트가 초록인 채 전량 401로 운영될 수 있습니다.
- OCC 재시도·충돌 분기와 `guildConfigService`의 `cacheEpoch`·`cacheMutations` 조정에도 테스트가 없습니다. `ARCHITECTURE.md:209`가 "최대 3회 자동 재시도"를 선언하지만 해당 문자열을 검색해도 0건입니다.
- DM 실패 처리와 `dmFormat: 'list'` 경로 전체가 미테스트입니다. 약 20개 `createDM` mock이 전부 항상 성공하는 하드코딩 sender이며, list 모드 테스트는 하나도 없습니다.
- `docs/05-qa/*.qa-report.md`의 "Pre-Release Scan" 표는 **bkit** 스캐너 결과이며, 보고서 스스로가 이 도구가 `lib/`·`hooks/`·`servers/` 구조의 JavaScript 프로젝트용이라 이 저장소를 분석하지 못한다고 밝힙니다. 분석을 이해하지 못한 스캐너가 "0 critical, 0 warning"을 보고한 것은 **스캔하지 않은 것보다 나쁘게** 근거 없는 확신을 문서에 더합니다. 또한 같은 스위트를 설명하며 통과 수가 167·173·181·213으로 서로 다릅니다. 스캔 표를 삭제하거나 "자동 정적 스캐너를 적용하지 않음"으로 대체하고, L2 표기는 동일한 in-process fetch mock을 재사용한다는 사실을 명시할 것을 권합니다.
- `scripts/migrate-pg-to-turso.ts`(24.4KB)는 테스트가 없고 `tsc` 대상에서도 제외되어 있습니다. `--force` 경로가 대상 행을 영구적으로 덮어쓰므로 위험도가 가장 높은 미검증 스크립트입니다.
- `docs/README.md`의 목차에 `docs/adr/`와 `docs/05-qa/`가 없습니다.

## 11. 확인되어 양호한 부분

판정과 별개로 재확인한 항목입니다. 후속 리뷰에서 중복 검토하지 않아도 됩니다.

- **OCC는 실제로 견고합니다.** `setGuildConfig`·`setUserConfig`은 `SELECT`-후-`UPDATE`가 아니라 **단일** `UPDATE ... WHERE id = ? AND version = ?`를 사용합니다. drizzle의 libsql 드라이버가 `client.transaction()`을 모드 없이 호출해 `BEGIN IMMEDIATE`로 진입하므로 읽기와 쓰기가 하나의 쓰기 잠금 트랜잭션 안에 있습니다. **이 사실이 OCC의 안전성의 근거입니다.** 향후 `mode: 'deferred'`로 바꾸면 갱신 손실 창이 조용히 열리므로 코드 주석으로 남겨야 합니다.
- `KeyedMutex`는 누수·예외 안전합니다. 대기자를 이전 promise에 체인하고 이전 실패를 `.catch(() => {})`로 흡수하며 `finally`에서 다음 대기자를 해제하고 맵 항목을 삭제합니다. `test/mutex.test.ts`가 거부 후 성공과 `size === 0`을 단언합니다. `test/cacheRecovery.test.ts`는 정확한 지연 수열 `[1000,2000,4000,8000,16000,30000,30000]`을 검증합니다.
- `mutateIgnoredDomains`는 가장 잘 설계된 쓰기 경로입니다. 락 안에서 행 존재를 보장하고 최신 행을 다시 읽어 다음 배열을 도출한 뒤 버전 가드 UPDATE를 수행합니다. 변경 함수가 순수 함수여서 테스트 가능하고 경합 프리이 명확합니다.
- Sink 응답 검증은 이 저장소의 가장 견고한 부분입니다. 모든 엔드포인트가 스키마를 통과해야 하고, 한 행이 나쁘면 목록 전체가 실패하며, HTML 응답은 합성 502로 거부되고, 2xx 오류 envelope가 정상 링크가 될 수 없습니다. `createLink`만 재시도하지 않는 것도 올바릅니다.
- `safeHttp`의 SSRF 방어는 표면적인 수정이 아닙니다. IP를 소켓 `lookup`에 고정해 TOCTOU/DNS 리바인딩 창을 닫고, 리다이렉트 hop마다 재검증합니다.
- 비밀 처리는 깨끗합니다. CI 시크릿은 env로만 전달되고 로그에 새지 않으며(`set -x` 없음), `parse-env.js`는 **키 이름만** 기록하고 파일을 `0o600`으로 생성하며 다중 줄 값을 거부합니다. `checkout`은 `persist-credentials: false`, `permissions`는 최소입니다. 소스에 `any`는 0개이고 `noUncheckedIndexedAccess`가 켜져 있으며 `README`·`SPECIFICATION`의 `any` 금지 서술은 사실과 일치합니다.
- `dashboardLinkSnapshot`은 정리된 LRU+TTL이며, 소비자는 defer 후 권한 있는 최신 레코드를 다시 조회하므로 스냅샷은 Discord 3초 ACK 창 안에서 모달을 채우는 용도로만 쓰입니다. 캐시 사용처가 적절합니다.
- 자체 URL 무한 단축은 없습니다. `messageCreate.ts:365`가 Sink 호스트네임을 비교해 건너뜁니다. `domain.ts`는 정확 또는 `.domain` 접미 일치로 접두사 오일치가 없고, `nottenor.com`은 `tenor.com`과 매치되지 않습니다.
- `test/deploySimulation.test.ts`와 `test/fixtures/fake-docker.sh`는 `mkdtemp` 격리 상태에서 실제 `kill -KILL`을 주입하는 시뮬레이션입니다. 모크가 아닙니다.
- `test/ownedLinkCatalog.test.ts`는 0·1·1000·1001·2000·2001 경계에서 명시적 미완결 라벨링을 검증합니다.

## 12. 이번 문서화 자체의 범위

이번 작업은 문서 추가만 하며 애플리케이션·DB·CI 동작을 변경하지 않습니다. 권장 수정은 모두 구현되지 않았습니다. 체크는 **실제 수정과 검증이 끝난 뒤** 완료합니다. 후속 PR에서는 해당 ID, 수정 커밋/PR, 검증 결과를 연결하고 남은 제한을 기록합니다. 초기 리뷰의 관찰 사실은 삭제하지 않고 해결 상태를 별도로 남기는 것을 권장합니다.
