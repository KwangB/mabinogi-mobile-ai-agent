---
name: mabi-doctor
description: 마비노기 모바일 AI 커넥터 연결 문제 진단. "연결이 안 돼", "도구가 안 보여", "cli_not_found", "한글 이름이 not_found" 같은 상황이나 처음 설치 직후에 사용.
argument-hint: "[증상]"
---

# 연결 진단

증상: $ARGUMENTS

위에서부터 순서대로 확인하고, **처음 걸리는 항목에서 멈춰** 사용자에게 조치를 안내한다. 설정 파일·게임 파일을 임의로 고치지 않는다.

## 0. 플랫폼
- AI 커넥터는 **Windows PC 버전 전용**이다. 지금 macOS/Linux 에서 실행 중이면 게임 CLI 를 실행할 수 없다 → `docs/windows-setup.md` 안내(게임이 설치된 Windows PC 에서 이 폴더를 열어야 함). WSL 은 가능(`/mnt/c/Nexon/...` 자동 인식).
- macOS 에서 기능만 시험해 보려면 모의 CLI: `README.md` 의 "게임 없이 시험하기".

## 1. MCP 서버가 떠 있는가
- `mcp__mabinogi__*` 도구가 안 보이면: 터미널에서 `claude mcp list` → `mabinogi … ✓ Connected` 여야 한다.
  - `Pending approval` → Claude Code 를 이 폴더에서 다시 실행해 프로젝트 MCP 서버를 승인.
  - `Failed` → `node --version`(18 이상 필요) 확인, 이 폴더(프로젝트 루트)에서 실행했는지 확인, `node server/index.mjs` 를 직접 실행해 오류 메시지 확인.
  - 코드 자체 점검: `node server/test/smoke.mjs` (게임 없이 전 항목 검사, 마지막 줄이 `N/N passed`).
  - 채팅·연주 도구가 안 보이는 것은 정상이다(기본 `MABI_PROFILE=core`). 필요하면 `.mcp.json` 에서 `full` 로 바꾸고 `extras/skills/` 의 스킬을 `.claude/skills/` 로 복사한다.

## 2. `status` 결과 해석
| 결과 | 원인 | 조치(사용자에게 안내) |
|---|---|---|
| `error: cli_not_found` | CLI 경로가 다름 | 게임 설치 폴더에서 `MabinogiMobile_CLI.exe` 위치 확인 → `.mcp.json` 의 `env` 에 `"MABINOGI_CLI_PATH": "D:\\...\\MabinogiMobile_CLI.exe"` 추가 후 Claude Code 재시작 |
| `connected:false` (`not_connected`) | 게임 미실행 / 월드 미접속 / 토글 OFF | ① PC 버전 실행 ② 캐릭터로 월드 접속 ③ `[메뉴(≡)]→[환경 설정]→[게임]→[AI 제어]→AI 커넥터(Beta)` ON → 이용 확인 팝업에서 체크 후 [활성화]. **7일 미사용 시 자동 OFF** 되므로 오랜만이면 다시 켠다 |
| `capabilities.loading:true` | 카탈로그 준비 전 | 월드 접속 완료 후 `status(refreshCapabilities:true)` |
| `newCommands` / `missingCommands` 있음 | 게임 패치로 명령 변경 | `query(capabilities, compact:false, filter)` 로 사양 확인, `docs/field-notes.md` 에 기록 |
| `empty_response` / `invalid_json` | CLI 가 비정상 종료 | `raw` 내용을 사용자에게 보여 주고 게임 재시작 권유 |

참고: 게임 프로세스는 안티치트 때문에 PowerShell `Get-Process` 로는 안 보일 수 있다. 실행 여부는 `status` 로 판단한다.

## 3. 한글 이름이 계속 `not_found` / 빈 결과
- 서버는 한글 본문을 원문으로 보내 보고, 실패하면 `base64:` 방식으로 1회 자동 전환한다. `status` 의 `cli.bodyEncoding` / `encodingConfirmed` 확인.
- 계속 실패하면 `.mcp.json` 의 `env` 에 `"MABI_BODY_ENCODING": "base64"`(또는 `"raw"`)를 고정해 보도록 안내.
- 그래도 없으면 진짜 없는 이름이다 → `filter` 를 더 짧게 해서 정확한 `DisplayName` 을 찾는다.

## 4. 활동이 거부될 때
- `budget_exceeded` / `daily_budget_exceeded` / `reserve_protected` → 보호 장치. 값은 `.mcp.json` 의 `MABI_WINGS_SESSION_BUDGET` / `MABI_WINGS_DAILY_BUDGET` / `MABI_WINGS_RESERVE`. **사용자가 직접** 바꾸고 재시작해야 한다.
- `bag_nearly_full` → 가방 95% 이상(채집을 시작해도 곧 끝나 날개만 낭비). 가방을 비운다.
- `recent_failure` → 방금 같은 활동이 비용을 쓰고 중단됨. 원인 해결을 확인한 뒤 `retryAfterFix:true`.
- `busy` → 진행 중 작업이 있음: `job(action:"status")`.
- `blocked` → 게임 화면의 팝업/대화/1시간 확인을 사용자가 직접 처리.

## 5. 기록 확인
- 서버가 게임에 보낸 모든 명령은 `logs/mabi-YYYY-MM-DD.jsonl` 에 남는다(시간·명령·본문·결과). 문제가 재현되면 마지막 몇 줄을 읽어 원인을 설명한다.
