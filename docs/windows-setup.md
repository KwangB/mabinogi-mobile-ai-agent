# Windows PC 설치·연결 가이드

AI 커넥터는 **Windows PC 버전 전용**이다. 이 폴더는 macOS 에서 작성·테스트(모의 CLI)했고, 실제 사용은 게임이 설치된 Windows PC 에서 한다.

## 1. 준비물 (Windows PC)

| 항목 | 확인 방법 |
|---|---|
| 마비노기 모바일 PC 버전(9/17 이후 최신) | 기본 설치 경로 `C:\Nexon\MabinogiMobile\` 에 `MabinogiMobile_CLI.exe` 가 있어야 함 |
| Node.js 18 이상 | `node --version` |
| Git for Windows | Claude Code 의 Bash 도구가 Git Bash 를 사용 |
| Claude Code | `claude --version` (설치: https://code.claude.com/docs) |

## 2. 이 폴더 옮기기

폴더 전체(`.claude/`, `.mcp.json` 같은 숨김 파일 포함)를 Windows PC 로 복사한다. USB·클라우드 드라이브·git 무엇이든 가능. `logs/` 와 `node_modules` 는 필요 없다(의존성 없음).
권장 위치: `C:\Users\<이름>\mabinogi-mobile-ai-agent` (경로에 공백·한글이 없는 곳).

## 3. 코드 자체 점검 (게임 불필요)

```bash
node server/test/smoke.mjs
```
마지막 줄이 `33/33 passed` 처럼 전부 통과로 나오면 서버·보호 장치는 정상이다.

## 4. 게임 쪽 설정

1. PC 버전 실행 → 캐릭터로 **월드 접속**.
2. `[메뉴(≡)] → [환경 설정] → [게임] → [AI 제어] → [마비노기 모바일 AI 커넥터(Beta)]` 토글 ON → 안내 확인 체크 → **[활성화]**.
3. 7일간 쓰지 않으면 자동으로 꺼진다. 오랜만에 쓸 때는 다시 켠다.

## 5. Claude Code 연결

```bash
cd C:\Users\<이름>\mabinogi-mobile-ai-agent
```
```bash
claude
```
- 처음 실행하면 프로젝트 MCP 서버(`mabinogi`) 사용 승인을 묻는다 → 승인. (`.claude/settings.json` 에 사전 승인이 들어 있어 묻지 않을 수도 있다.)
- 확인: 터미널에서 `claude mcp list` → `mabinogi … ✓ Connected`
- 첫 대화: **"마비노기 모바일 지금 켜져 있고 AI 커넥터 연결되는지 확인해줘"** 또는 `/mabi-doctor`
- 그다음: `/mabi-start`

게임을 기본 경로가 아닌 곳에 설치했다면 `.mcp.json` 의 `env` 에 추가:
```json
"MABINOGI_CLI_PATH": "D:\\Games\\MabinogiMobile\\MabinogiMobile_CLI.exe"
```

## 6. 첫 실사용 때 확인해서 `docs/field-notes.md` 에 적어 둘 것

이 Mac 에서는 검증할 수 없었던 항목들이다. 한 번만 확인하면 된다.

- [ ] `status` 가 `connected:true`, `capabilities.count` 가 28 인가(다르면 패치로 바뀐 것)
- [ ] 한글 필터 조회가 되는가: "양털 채집 가능한지 봐줘" → `status` 의 `cli.bodyEncoding` 값(raw / base64)
- [ ] 활동 1회 후 `wings.spentNow` 가 5 인가
- [ ] `gather` 의 `stopAtCount`(예: 10개)가 실제로 조기 종료되는가, 몇 개 초과되는가
- [ ] 연주(`play_music`) 시 `wings.spentNow` 가 0 인가 5 인가
- [ ] 채팅 전송 시 게임 화면에도 승인 팝업이 뜨는가
- [ ] 1시간 연속 사용 시 어떤 응답이 오는가(`blocked` 의 `kind` 값)
- [ ] 희귀 드롭 목표 채집·여분 도구 자동 교체가 실제로 되는가(`docs/field-notes.md` 의 생활 관련 항목)
- [ ] 토글을 켰을 때 게임이 Claude Code 에 자동 등록하는 것이 있는가(`claude mcp list`, `~/.claude/skills/` 등). 공식 등록분과 이 프로젝트가 **중복으로 같은 일을 하면** 한쪽만 쓴다.

## 7. WSL 에서 쓰는 경우

WSL 안의 Claude Code 도 가능하다. 서버가 `/mnt/c/Nexon/MabinogiMobile/MabinogiMobile_CLI.exe` 를 자동 인식해 Windows 실행 파일을 interop 으로 호출한다. 경로가 다르면 `MABINOGI_CLI_PATH` 를 `/mnt/...` 형식으로 지정.

## 8. (실험적) Mac 의 Claude Code 에서 Windows PC 의 게임 제어

권장하지 않는다. 공식 안내는 "AI 도구가 설치된 PC"를 전제로 하며, 아래 방식은 **검증되지 않았고 정책상 회색지대**다(운영정책 11-2). 그래도 시험하려면:

1. Windows PC 에 OpenSSH 서버 설치·키 인증 설정(같은 Windows 계정으로 로그인).
2. Mac 의 `.mcp.json` `env` 에:
   ```json
   "MABI_TRANSPORT": "ssh",
   "MABI_SSH_HOST": "사용자@192.168.0.10"
   ```
3. 서버는 `ssh <host> C:\Nexon\...\MabinogiMobile_CLI.exe <명령> base64:<본문>` 형태로 호출한다(본문은 항상 base64).

알려진 불확실성: SSH 세션에서 게임의 named pipe 에 접근 가능한지 미확인 / 1시간 확인·채팅 승인·`blocked` 해결은 어차피 **게임 화면 앞에서 직접** 해야 한다. 자리를 비운 채 원격으로 돌리는 용도로 쓰지 말 것.

## 문제 해결

`/mabi-doctor` 또는 `.claude/skills/mabi-doctor/SKILL.md` 참고. AI 도구 자체의 오류는 공식 안내대로 해당 AI 도구 제공사에 문의.
