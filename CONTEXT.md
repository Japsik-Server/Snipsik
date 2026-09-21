# Snipsik Context

Snipsik은 Discord 메시지 내 긴 URL을 감지하여 짧은 링크로 자동 변환하고, 사용자에게 일시성 대시보드와 DM을 통해 링크 라이프사이클을 제공하는 링크 단축 봇 도메인입니다.

## Language

**User Config**:
특정 Discord 사용자에게 귀속되는 개인화 설정으로, 서버 레벨 감시 설정보다 우선하여 적용되는 사용자별 환경 설정.
_Avoid_: User preference, Member settings, Profile options

**Auto DM Mode**:
메시지 내 긴 URL 감지 시 해당 사용자에게 단축 링크 DM을 발송할지 여부를 결정하는 3단계(Tri-state) 정책(`inherit`, `on`, `off`).
_Avoid_: DM toggle, Watch switch, Notification flag

**DM Format**:
사용자에게 DM을 전송할 때 본문을 구성하는 방식(`replace`, `list`).
_Avoid_: Message style, Template mode, Output layout

**Reconstructed Message (치환 본문)**:
사용자가 보낸 원본 메시지 텍스트에서 긴 URL들만 생성된 단축 URL로 정밀 교체한 완성형 메시지 본문.
_Avoid_: Edited message, Parsed message, Fixed text

**Config Panel**:
대시보드(`/link dashboard`) 및 `/link config` 명령어를 통해 제공되는 사용자의 개인 설정을 확인하고 원클릭으로 변경할 수 있는 Discord Components v2 뷰.
_Avoid_: Settings modal, Preference menu, Option dialog

**Watch Channel**:
서버 관리자가 지정하여 해당 채널 내 모든 긴 URL을 자동 감시하도록 등록된 Discord 텍스트 채널.
_Avoid_: Monitored channel, Target room, Listening channel

**Fixupx Conversion**:
감시 채널에서 감지된 Twitter/X 상태(Status) 링크를 Discord 내 동영상/이미지 임베드가 원활히 렌더링되도록 `fixupx.com`으로 자동 변환하는 사용자 설정 기능.
_Avoid_: Twitter fix, URL rewrite, X embed patch

**Ignored Domains**:
URL 자동 단축 대상에서 제외하도록 등록된 도메인 목록(기본 시스템 미디어 서비스 + 길드/유저/전역 설정).
_Avoid_: Blocked domains, Blacklisted domains, Excluded hosts

**KeyedMutex / OCC**:
LibSQL/SQLite 환경에서 단일 프로세스 내 동일 길드/유저 단위 비동기 뮤텍스와 DB `version` 단조 증가 카운터를 결합하여 데이터 정합성을 보장하는 동시성 제어 아키텍처.
_Avoid_: Row lock, Pessimistic lock, Transaction lock

**Cache Recovery**:
DB 초기 연결 또는 재연결 일시 장애 시 봇 프로세스를 종료하지 않고, 기존 유효 스냅샷을 보호하며 백그라운드 지수 백오프로 캐시를 재구축하는 회복 탄력성 메커니즘.
_Avoid_: Cache restart, DB retry loop, Reload handler
