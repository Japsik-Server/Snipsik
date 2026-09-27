# 🛡️ 보안 정책 (Security Policy)

English follows Korean. / 한국어 안내 후 영문 안내가 이어집니다.

---

## 🇰🇷 한국어 안내

Snipsik 프로젝트는 봇 및 사용자의 데이터 보안을 매우 중요하게 생각합니다. 서비스의 보안 취약점을 발견하셨다면 다른 사용자들에게 피해가 가지 않도록 책임 있는 공개(Responsible Disclosure) 절차를 준수해 주시기 바랍니다.

### 🚨 취약점 제보 방법 (Reporting a Vulnerability)

**절대로 공개된 GitHub Issue나 토론장에 보안 취약점을 게시하지 마세요.**

보안 취약점은 GitHub의 공식 **비공개 취약점 보고(Private Vulnerability Reporting)** 기능을 통해 제보해 주시기 바랍니다.

1. 저장소 상단의 **[Security](https://github.com/Japsik-Server/Snipsik/security)** 탭으로 이동합니다.
2. 좌측 메뉴에서 **Advisories**를 선택한 후, **"Report a vulnerability"** 버튼을 클릭합니다.
   - 바로가기: [GitHub Security Advisory 제보 링크](https://github.com/Japsik-Server/Snipsik/security/advisories/new)
3. 취약점에 대한 상세 정보(영향도, 재현 절차, 개념 증명 코드 등)를 작성하여 제출합니다.

### 📋 제보 시 포함해 주실 내용

- 취약점의 유형 및 위치 (예: SSRF, 인증 우회, 권한 상승 등)
- 문제를 재현할 수 있는 명확한 단계 (Steps to reproduce)
- 개념 증명(PoC) 스크립트 또는 요청/응답 예시
- 잠재적으로 미칠 수 있는 영향도 (공격 시나리오)

### ⏱️ 조치 프로세스

1. **접수 확인**: 제보 접수 후 메인테이너가 48시간 이내에 확인 및 회신합니다.
2. **검증 및 패치**: 취약점을 검증하고 비공개 브랜치에서 수정 패치를 개발합니다.
3. **배포 및 공개**: 패치가 프로덕션에 적용된 후 취약점 공지(Security Advisory)를 발행합니다.

---

## 🇺🇸 English Guide

We take the security of Snipsik seriously. If you discover a security vulnerability, please follow responsible disclosure guidelines.

### 🚨 How to Report a Vulnerability

**DO NOT disclose vulnerabilities via public GitHub Issues or discussions.**

Please submit vulnerabilities confidentially through GitHub's **Private Vulnerability Reporting**:

1. Navigate to the **[Security](https://github.com/Japsik-Server/Snipsik/security)** tab of this repository.
2. Click **Advisories** and then click **"Report a vulnerability"**.
   - Direct link: [Report a vulnerability](https://github.com/Japsik-Server/Snipsik/security/advisories/new)
3. Fill out the report with full details (impact, steps to reproduce, PoC).

### 📋 What to Include

- Type and location of the issue (e.g., SSRF, Auth bypass, Privilege escalation)
- Step-by-step instructions to reproduce the issue
- Proof of Concept (PoC) or sample payloads
- Potential impact and threat scenarios

### ⏱️ Response Timeline

- **Acknowledgment**: Within 48 hours.
- **Fix & Patch**: Tested and prepared in a private temporary fork.
- **Disclosure**: Published via GitHub Security Advisory after the fix is deployed.
