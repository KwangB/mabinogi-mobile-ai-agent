# mabinogi-mobile-ai-agent — 마비노기 모바일 AI 커넥터(Beta) 초보자용 세팅

2026-09-17 에 추가된 **마비노기 모바일 AI 커넥터(Beta)** 를 Claude Code 로 쓰기 위한 프로젝트 키트. **초보 모험가의 네 가지 일**에 집중하고, **토큰(요금)과 정령의 날개를 아끼도록** 설계했다.

| # | 목적 | 말하는 법 | 스킬 |
|---|---|---|---|
| 1 | 숙제 (일일·주간) | "숙제 뭐 남았어?" · "검은 구멍 했어" | `/mabi-homework` |
| 2 | 생활 레벨 올리기 | "나무 베기 올리고 싶어" | `/mabi-life` |
| 3 | 특정 채집·제작 돌리기 | "양털 모아줘" · "○○ 10개 만들어줘" · "가공 받아 와" | `/mabi-gather` · `/mabi-craft` |
| 4 | 모험가 길드 정기 의뢰(주간·재화 소모) | "정기 의뢰 얼마나 했어?" · "돌 재화 충분해?" | `/mabi-guild-request` |

처음이면 `/mabi-start`, 연결이 안 되면 `/mabi-doctor`.

> **비공식 팬 프로젝트입니다.** 넥슨·데브캣과 무관하며, 게임에 포함된 공식 CLI 를 그대로 호출할 뿐 게임·CLI 를 변조하지 않습니다. 그래도 운영정책 11조에 따라 **AI 로 한 모든 행위의 책임과 비용(AI 요금·정령의 날개)은 사용하는 본인**에게 있습니다. 베타 기능이라 언제든 바뀔 수 있고, 이 도구는 무보증(MIT)으로 제공됩니다. 서버는 네트워크에 접속하지 않으며 게임에 보낸 모든 명령을 `logs/` 에 남깁니다.

## 빠른 시작 (Windows PC)

1. 준비: 마비노기 모바일 **PC 버전**(2026-09-17 이후), [Node.js 18+](https://nodejs.org), Git for Windows, [Claude Code](https://code.claude.com/docs).
2. 받기:
   ```bash
   git clone https://github.com/KwangB/mabinogi-mobile-ai-agent.git
   ```
3. 점검(게임 없이): 폴더 안에서 `node server/test/smoke.mjs` → 마지막 줄 `33/33 passed`.
4. 게임에서 켜기: 캐릭터로 접속한 뒤 `[메뉴(≡)] → [환경 설정] → [게임] → [AI 제어] → 마비노기 모바일 AI 커넥터(Beta)` ON.
5. 이 폴더에서 `claude` 실행 → 프로젝트 MCP 서버 `mabinogi` 승인 → **`/mabi-start`**.

자세한 절차와 첫 실행 체크리스트: [docs/windows-setup.md](docs/windows-setup.md)

> ⚠️ AI 커넥터는 **Windows PC 버전 전용**이다. 이 폴더는 macOS 에서 만들고 모의 CLI 로만 검증했다 → 실제 사용은 [docs/windows-setup.md](docs/windows-setup.md). 숙제의 수동 기록은 게임 없이도 쓸 수 있다.

## 구성

| 경로 | 역할 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 에이전트 지침(짧게 유지): 4대 목적, 절대 규칙, 날개·토큰 아끼는 법, 초보자에게 말하는 법 |
| [.mcp.json](.mcp.json) | MCP 서버 `mabinogi` 등록 + 보호 장치 값 |
| [.claude/settings.json](.claude/settings.json) | 권한: 조회·숙제·정지는 자동 / **채집·제작·가공은 매번 확인** / CLI 직접 호출도 확인 / 게임 폴더 수정 금지 |
| [.claude/skills/](.claude/skills/) | 핵심 스킬 7개 |
| [extras/skills/](extras/skills/) | 선택 스킬 6개(연주, 어비스·레이드 가이드, 도구 점검, 재료 계획·가공·브리핑 단독판) |
| [server/](server/) | 공식 CLI 를 그대로 호출하는 MCP 서버(Node 18+, 의존성 없음) + 모의 CLI + 테스트 33종 |
| [data/homework.json](data/homework.json) | 숙제 목록·횟수, 정기 의뢰 공략 설정(장소·더블 루팅·1회 비용), 어비스/레이드 가이드 데이터 |
| [docs/](docs/) | 리서치 요약, 명령 레퍼런스, 숙제 근거, 생활 레벨업 가이드, Windows 설치, 실사용 기록장 |

```
Claude Code ─MCP─▶ server/index.mjs ─실행─▶ MabinogiMobile_CLI.exe ─named pipe─▶ 게임
                    ├ 날개 보호: 이름·도구·재료 사전 검증 → 가방 점검 → 재시도 차단 → 세션/하루 예산·잔액 하한 → 실지출 기록
                    ├ 토큰 절약: 핵심 도구 10개만 노출, 압축 출력, 긴 작업은 job 으로 대기
                    └ 숙제 트래커: 06시/월요일 초기화 계산, 일일·주간 미션·정기 의뢰 자동 반영
```

## 정령의 날개를 아끼는 장치 (전부 "돈이 나가기 전" 무료 단계에서 동작)

| 장치 | 막는 낭비 |
|---|---|
| 이름·도구·재료 사전 검증 | 잘못된 이름, 도구 없음, 재료 부족으로 실패하는 호출 |
| 가방 95% 이상이면 채집 거부(80%↑ 경고) | 시작하자마자 무게 초과로 끝나는 채집 |
| 직전 실패 재시도 차단(10분) | `blocked`·`tool_broken` 직후 같은 요청을 다시 해서 5개를 또 쓰는 것 |
| 세션 예산 30 · **하루 상한 100**(세션을 새로 열어도 유지) · 잔액 하한 20 | 과다 지출 |
| 지침: 채집은 한 번에 끝까지, 제작은 `craftCount` 상한까지 묶기, 가공 등록 대신 수령만 | 호출 수 자체 |
| 결과에 `perWing`(날개 1개당 획득량) | 어떤 작업이 효율적인지 보이게 |

## 토큰을 아끼는 장치

- 세션마다 고정으로 실리는 글자 수 약 22,400 → **약 11,000** (지침·서버 안내·도구 정의·스킬 설명 합계, −51%).
- 숙제 보드 출력 2,710 → **643자**. 상세가 필요할 때만 `detail:true`.
- 도구 묶음 `MABI_PROFILE=core`(10개). 채팅·연주 등은 `full` 로 바꿀 때만 실린다.
- 긴 채집은 270초 단위로 기다린다(프롬프트 캐시가 식지 않는 간격). 기다리는 동안 에이전트는 말하지 않는다.
- **가장 큰 절약은 모델 선택이다.** 숙제 체크·채집 같은 일상 작업은 Sonnet 이나 Haiku 로 충분하다(세션에서 모델을 바꾸거나 `.claude/settings.json` 에 `"model"` 지정).

## 설정값 (`.mcp.json` → `env`) — 바꾼 뒤 Claude Code 재시작

| 변수 | 이 프로젝트 | 설명 |
|---|---|---|
| `MABI_PROFILE` | core | `full` = 채팅·연주·일어서기·신규 명령 호출 도구까지 노출 |
| `MABI_WINGS_SESSION_BUDGET` | 30 | 한 세션에서 AI 가 쓸 수 있는 정령의 날개(= 맡기기 6번) |
| `MABI_WINGS_DAILY_BUDGET` | 100 | 하루(06:00 KST 기준) 상한. 0 = 끔 |
| `MABI_WINGS_RESERVE` | 20 | 잔액이 이 아래로 내려가는 활동은 거부 |
| `MABI_BAG_REFUSE_PERCENT` / `MABI_BAG_WARN_PERCENT` | 95 / 80 | 가방 점검 기준 |
| `MABI_RETRY_GUARD_SEC` | 600 | 실패 직후 재시도 차단 시간 |
| `MABI_MAX_WAIT_SEC` | 270 | 도구 호출 1회가 기다리는 최대 시간(넘으면 `job` 핸들) |
| `MABI_ACTION_TIMEOUT_SEC` | 3600 | 활동 1건의 최대 시간(희귀 드롭 목표 채집은 오래 걸린다) |
| `MABINOGI_CLI_PATH` | 자동 | 게임을 기본 경로가 아닌 곳에 설치했을 때 |
| `MABI_BODY_ENCODING` | auto | 한글 이름이 계속 not_found 면 `raw`/`base64` 고정 |
| `MABI_LOG` / `MABI_LOG_DIR` | on / `logs/` | 게임에 보낸 모든 명령의 감사 로그 |

보호 장치 값은 **사용자만** 바꾼다(에이전트는 바꾸지 않도록 지침에 명시).

## 선택 기능 켜기

1. `.mcp.json` 의 `MABI_PROFILE` 을 `full` 로.
2. `extras/skills/` 에서 필요한 폴더를 `.claude/skills/` 로 복사: `mabi-music`(연주), `mabi-raid-guide`(어비스·레이드 가이드), `mabi-gearcheck`(도구 점검), `mabi-plan`·`mabi-alter`·`mabi-briefing`(단독판).
   - 어비스·레이드 안내와 도구 점검은 핵심 도구만으로도 된다(`homework` 의 guide, `snapshot` 의 gear). 스킬은 절차를 더 자세히 적어 둔 것이다.

## 점검

```bash
node server/test/smoke.mjs
```
게임 없이 33개 항목을 검사한다(마지막 줄 `33/33 passed`).

```bash
claude mcp list
```
`mabinogi … ✓ Connected`

```bash
claude --mcp-config examples/mcp.mock.json --strict-mcp-config
```
모의 게임으로 모든 흐름을 눌러 볼 수 있다(실제 게임과 응답이 다를 수 있다).

## 하지 않는 것 (의도적)

- 무인 반복·방치형 자동화, 전투 자동화(던전·어비스·레이드, 패턴 회피), 수리하러 가기 — 커넥터에 명령이 없고, 화면 제어·매크로 우회는 운영정책 11조 위반·계정 제재 대상이다.
- 게임/CLI 파일 수정, 거래소·캐시샵·길드 운영·1:1 대화 흉내.

## 알아 둘 한계

- **실제 게임으로는 한 번도 돌려 보지 못했다.** 명령·응답 형식은 공식 공지와 커뮤니티가 공개한 자료 기준이다. 첫 실사용 때 [docs/windows-setup.md](docs/windows-setup.md) 6절을 확인하고 [docs/field-notes.md](docs/field-notes.md) 에 적는다.
- 숙제·생활 가이드의 ⚠️ 항목은 2025년 자료이거나 횟수를 확인하지 못했다.
- 베타 기능이라 패치로 바뀔 수 있다. `status` 가 명령 변동을 알려 준다.
