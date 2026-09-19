# MabinogiMobile_CLI 명령 레퍼런스 (카탈로그 기준일 2026-09-17)

> 출처: 게임 CLI 의 `capabilities` 응답을 공개한 커뮤니티 자료(`oupure7-cyber/MABINOBI` 의 `10_RESEARCH/`)와 공식 에린 가이드.
> 2026-09-19 Windows 실제 게임에서 `capabilities`(28개)·`status`·`snapshot`·`get_gatherable_items`·`get_craftable_items`·`get_alterable_items`·`execute_gathering` 을 확인했다. 그 밖의 명령은 커뮤니티 자료 기준이라 **직접 검증하지 못했다.** 최종 기준은 항상 실제 게임의 `capabilities` 응답이다(`query(capabilities, compact:false)`). 베타 기간에는 바뀔 수 있다.

## 구조

- `C:\Nexon\MabinogiMobile\MabinogiMobile_CLI.exe` — 게임 클라이언트에 포함(개발사 Devcat, 버전 0.1.0). 별도 설치 없음.
- **1회성(one-shot)**: `MabinogiMobile_CLI.exe <명령> [본문]` → JSON 을 stdout 에 출력하고 종료. 실행 중인 게임과 **named pipe** 로 통신한다(상주 서버 아님).
- `--help` / `status`(→ `{"pipe":"connected"}`) / `capabilities` / 그 외 dispatch 명령.
- 게임 프로세스는 안티치트(BlackCipher) 때문에 `Get-Process` 로 안 보일 수 있다 → 실행 여부는 `status` 로 판단.
- 거래소·캐시샵·길드 운영·1:1 대화·아이템 버리기/분해·자동 전투 시작 명령은 **카탈로그에 아예 없다**(정책이 인터페이스 수준에서 강제됨). `get_activity` 로 자동 진행 "상태 조회"만 가능.
- 캐릭터 이름은 본인 것도 제공되지 않는다. `RealmName` = 서버(월드) 이름.

## 28개 명령 요약

| # | 명령 | 분류 | 본문 | 비용 |
|---|---|---|---|---|
| 1 | `capabilities` | 메타 | – | – |
| 2 | `get_current_environment` | 조회 | – | – |
| 3 | `get_activity` | 조회 | – | – |
| 4 | `get_my_info` | 조회 | – | – |
| 5 | `get_quests` | 조회 | – | – |
| 6 | `get_currencies` | 조회 | – | – |
| 7 | `get_near_npcs` | 조회 | – | – |
| 8 | `get_near_pcs` | 조회 | – | – |
| 9 | `get_inventory` | 조회 | – | – |
| 10 | `get_music_scores` | 조회 | 제목 필터(원문) | – |
| 11 | `get_instruments` | 조회 | 이름 필터(원문) | – |
| 12 | `get_items` | 조회 | `{"category":"…","name":"…"}` | – |
| 13 | `get_social_actions` | 조회 | 필터(원문) | – |
| 14 | `get_daily_missions` | 조회 | – | – |
| 15 | `get_weekly_missions` | 조회 | – | – |
| 16 | `get_gatherable_items` | 조회 | 이름 필터(원문) | – |
| 17 | `get_alterable_items` | 조회 | 레시피/재료 필터(원문) | – |
| 18 | `get_altering_works` | 조회 | – | – |
| 19 | `get_craftable_items` | 조회 | 레시피/재료 필터(원문) | – |
| 20 | `write_chat` | 실행 | 원문 문자열(≤50자) | – · `requiresConfirm` |
| 21 | `play_music_score` | 실행 | `{"title":"…"}` | 표기 없음 |
| 22 | `change_instrument` | 실행 | `{"name":"…"}` | – |
| 23 | `stop_action` | 실행 | – | – |
| 24 | `stand_up` | 실행 | – | – |
| 25 | `execute_gathering` | 실행 | `{"displayName":"…"}` | **정령의 날개 5** |
| 26 | `execute_altering` | 실행 | `{"displayName":"…"}` | **정령의 날개 5** |
| 27 | `complete_altering_work` | 실행 | `{"displayName":"…"}` | 표기 없음 |
| 28 | `execute_crafting` | 실행 | `{"displayName":"…","craftCount":1}` | **정령의 날개 5** |

필터는 모두 대소문자 무시 부분일치. 본문을 비우면 전체 반환.

## MCP 도구 ↔ CLI 명령

| MCP 도구 | CLI 명령 | 래퍼가 추가로 하는 일 |
|---|---|---|
| `status` | `status`, `capabilities` | 카탈로그 변동 감지, 예산·작업 상태 |
| `query` | `get_*`, `capabilities` | 필터/`limit`/압축, 표시 이름 기준 평탄화 |
| `snapshot` | 여러 `get_*` | 묶음 요약 |
| `gather` | `execute_gathering` | 이름·도구 사전 검증, 예산/하한, 실측 지출, `stopAtCount` |
| `craft` | `execute_crafting` | 레시피·재료 사전 검증, 예산/하한 |
| `alter` | `execute_altering` | 레시피·재료 사전 검증, 예산/하한 |
| `collect_altered` | `complete_altering_work` | 완료 건 확인, 남은 시설 안내, 실측 지출 |
| `play_music` | `play_music_score` (+`change_instrument`) | 제목 검증, 실측 지출 |
| `change_instrument` | `change_instrument` | 이름 검증 |
| `stop_action` / `stand_up` | 동명 | – |
| `chat` | `write_chat` | 승인 플래그, 50자, 도배 간격, 인코딩 확정 |
| `raw_call` | 카탈로그의 신규 명령 | 전용 도구 우회 차단, 비용 언급 시 보호 장치 |

## 응답 형식

`status` 는 `{"pipe":"connected"}`. 그 외는 `status` 값과 본문으로 구성된다.

- `accepted` — 받아들여짐. 본문에 `result`(`completed` / `started` / `stopped` / `stopped_by_user`) 또는 **시작 후 중단**을 뜻하는 `error`(`blocked`, `overweight`, `timeout`, `canceled`, `tool_broken` …)가 온다.
- `rejected` — 시작 전 거부. 본문 `{ error, message }`.
- `invalid_body` — 본문 형식 오류.

봉투가 `{status, body:{…}}` 인지 `{status, …}` 평면형인지는 자료만으로 확정하지 못했다 → 래퍼는 둘 다(그리고 봉투 없는 본문도) 처리한다.
비용 활동의 성공 본문에는 `cost`(쓴 양과 남은 잔액을 적은 문장)가 포함된다. JSON 의 `\uXXXX` 이스케이프는 정상.

## 조회 명령 필드

**`get_current_environment`** — `ChannelDisplayName`, `GameSpaceDisplayName`, `WorldPosition`, `Weather`, `ErinnNow`(에린 시각), `Housing{ IsInHousing, IsOwnedHousing, CanEnterHousing, CannotEnterHousingReason, CanExitHousing }`

**`get_activity`**
- `autoPlay{ IsAutoPlaying, CanStartAutoPlay, AutoPlayTarget, AutoPlayTargetDisplayName }` — Target: none / quest / goddess_mission / shortcut / division_objective / recommended_activity / guide_mission. 분류를 말할 때는 `AutoPlayTargetDisplayName` 을 그대로, 없으면 번역하지 말고 생략.
- `autoTravel{ IsAutoTraveling, AutoTravelRemainingPositionCount }`, `combatState{ IsDead, IsReviving, IsInCombat }`, `dialogue{ IsDialoguePlaying, IsDialogueNextAvailable, IsWaitingForSelection }`
- `Dungeon{ State: NotInDungeon|Entering|InProgress|Cleared, IsBossBattleInProgress }`, `Battlefield{ IsInBattleField }`, `IsAbyssResultSequencePlaying`, `Tutorial{ IsPlaying }`, `Scenario{ IsInScenario, IsSequencePlaying }`
- `Performance{ IsPlaying, InstrumentName, MusicTitle, IsCopyingAllowed, IsLoop, StartAt, TotalDurationSeconds, ElapsedSeconds, RemainingSeconds, ChannelCount }`
- `Interaction{ HasTarget, IsTargetAttackable, AvailableInteractionType, LastRunningInteractionType, TargetKind }` — TargetKind: DungeonEntrance / Elevator / Fountain / CutscenePlayProp / Gimmick / Prop / Actor / None
- `Mode{ MainButtonState, MountPartState, SitState, IsPlayingMiniGame, IsHousingEditMode }` — MainButtonState: Hide / Stop / Combat / Interaction / Compass / ScenarioQTE / Fishing / FishingPull / Housing. `SitState:Sitting` 은 **의자**에 앉은 상태(→ `stop_action`). `/앉기` 는 여기에 반영되지 않는다(→ `stand_up`).

**`get_my_info`** — `Title`, `RealmName`(서버), `Level`, `EnabledCombatJobDisplayName`, `CombatScore`, `LivingScore`, `AttractivenessScore`, `DecorScore`, `HealthMax`, `AttackPower`, `DefencePower`, `STR`, `DEX`, `INT`, `LUCK`, `WILL`, `ArcaneResistance`, `PaladinStats{…}`, `Vitals{ HealthCurrent, HealthMax, ShieldAmount, ShieldMax, SatietyValue, SatietyMax, SatietyRatio, InventoryWeightCurrent, InventoryWeightMax, ActiveBuffCount }`. 능력치는 `{DisplayName, Value}` 객체이며 **`DisplayName` 을 그대로 능력치 이름으로 쓴다.**

**`get_quests`** — 현재 보이는 퀘스트 트래커 탭의 항목만. `QuestTitle`, `Source`, `SourceDisplayName`, `Objectives[{ Description, IsCompleted, Count, Goal }]`. 분류는 `SourceDisplayName` 그대로, 없으면 번역하지 말고 제목만.

**`get_currencies`** — `[{ DisplayName, Amount }]` (정령의 날개 포함)

**`get_near_npcs`** — 반경 30, 대화 가능한 NPC·동료. `Name`, `Title`, `DisplayName`, `Distance`

**`get_near_pcs`** — 반경 30. `RealmName`, `Title`, `Distance`, `ClothesCount`, `CrowdAppearanceColorCount`, `IsRobeWeared`, `IsHoodOn`, `IsWeaponHidden`, `Level`, `EnabledCombatJobDisplayName`, `CombatScore`, `LivingScore`, `AttractivenessScore`, `IsFriend`, `IsInParty`, `HasGuild`, `IsSameGuild`, `IsCoOwner`, `IsInCombat`, `Performance{…}`. 이름·길드명 없음.

**`get_inventory`** — `CurrentInventoryWeight(AsDecimal)`, `MaxInventoryWeight(AsDecimal)`

**`get_items`** — 소모품류(음식·재료·채집물 등)만. 장비/패션/펫 제외. `DisplayName`, `Category`, `CategoryDisplayName`, `Count`, `Location`(inventory / account_storage / character_storage), `IsLocked`. Category 예: Food, Ingredient, Consumable, Consumable_Box, Consumable_Growth, Quest.

**`get_music_scores`** — `Location`, `DisplayTitle`, `IsCopyingAllowed`, `IsLocked` · **`get_instruments`** — `Name`, `Durability`, `IsEquipped`

**`get_social_actions`** — `Behaviours[{ DisplayName, ChatCommands[] }]`, `Facials[{ DisplayName, EmojiText }]`. 실행은 `ChatCommands` 값(예: `/전통댄스`, `/손인사1`)이나 `EmojiText` 를 `write_chat` 으로 보낸다. **표시 이름(`/춤`, `/인사`)은 명령이 아니다.**

**`get_daily_missions` / `get_weekly_missions`** — `Title`, `Description`, `CurrentCount`, `GoalCount`, `IsCompleted`, `IsRewardReceived`, `HasShortcut`(일일=캐릭터, 주간=계정)

**`get_gatherable_items`** — `{ items:[{ DisplayName, ToolOk }] }`. 생활 스킬 레벨을 충족한 항목만 보인다(잠긴 항목은 숨김). `ToolOk:false` = 도구 없음/내구도 0.

**`get_alterable_items`** — `{ items:[{ DisplayName, Alterable, ProducedPerWork, Reason, MissingIngredients[{ DisplayName, Required, Owned }] }] }`. Reason: insufficient_facility_level / not_enough_ingredient / ingredient_locked / insufficient_transfer_cost

**`get_altering_works`** — `{ completedCount, works:[{ DisplayName, FacilityName, State: NotStarted|InProgress|Completed, IsCompleted, RemainingSeconds }] }`

**`get_craftable_items`** — `{ craftingUnlocked, items:[{ DisplayName, Craftable, ProducedPerCraft, Reason, MissingIngredients[…] }] }`. Reason 에 insufficient_living_skill_level / insufficient_decor_score 추가.

## 실행 명령 상세

**`execute_gathering`** (날개 5)
- 1회 호출에 지정 항목 **최대 100개**까지 채집 후 정지. 매 시도마다 소모품(예: 빈 병)이 필요하면 보유량만큼으로 상한이 낮아지고, 실제 적용된 상한이 `target` 으로 온다. 채집지는 갈 수 있는 가장 가까운 곳으로 자동 선택. 부산물도 나오지만 `gained`/`target` 은 지정 항목만 센다.
- 낚시 전용 항목: 낚시터 이동 → 자동 낚시 ON → `result: started` 로 즉시 반환. **자동 낚시는 목표가 없고 스스로 끝나지 않는다** → `stop_action`. 자동 낚시 설정은 이후에도 켜진 채 남는다.
- 성공 `completed{gained,target}` / 조기 종료 `stopped{gained,target,message}` / 시작 후 중단 `error: blocked|overweight|timeout|canceled|tool_broken` / 시작 전 거부 `not_found, no_route, insufficient_living_skill_level, overweight, tool_missing, tool_broken, required_consumable_missing, not_in_field, blocked`
- 커뮤니티 실측: 100개 채집에 보통 2분, 길면 15분.

**`execute_crafting`** (날개 5)
- `craftCount` = **제작 횟수**(결과물 수 아님). 기본 1, 시설별 상한(초과 시 `invalid_count` + `maxCount`). 이동 + 제작 + 결과 수령까지 한 호출, UI 자동 닫힘.
- 성공 `completed{craftCount,rewards,criticalRewards}` 또는 `stopped_by_user` / 거부 `crafting_locked, not_found, not_available, invalid_count, insufficient_living_skill_level, insufficient_facility_level, insufficient_decor_score, not_enough_ingredient, ingredient_locked, insufficient_transfer_cost, blocked, overweight, not_in_field, facility_not_found`

**`execute_altering`** (날개 5)
- 가공 1건을 대기열에 등록(시설 이동 포함)하고 `result: started`. 즉시 완성되지 않는다. N건이면 매번 `started` 확인 후 다시 호출.
- 거부에 `requires_user_interaction`(커넥터로 등록 불가 → 게임에서 직접), 시작 후 `component_not_found` 등 추가.

**`complete_altering_work`**
- `displayName` 의 아이템이 만들어지는 **한 시설**의 완료 작업 전부 수령. 그 아이템이 아직 진행 중이면 `not_completed_yet`. 성공 `{collected,rewards,criticalRewards,message}`. 수령 확인이 안 되면 `error: timeout` → `get_altering_works` 로 재확인.

**`write_chat`** — 원문 문자열(JSON 아님), 최대 50자. 일반 채팅 / 행동(`ChatCommands`) / 표정(`EmojiText`). 채널 전환(`/지역`, `/파티`), 긴급탈출, `#암호` 등 예약 명령은 `unsupported_command`. `rate_limited` 시 `retryAfterSeconds` 대기. `Metadata.requiresConfirm: true`.

**`play_music_score`** — 거부: not_found / no_instrument / not_available_on_combat / _riding / _dead / system_error
**`change_instrument`** — 거부: not_found / is_playing_instrument / not_available_on_dead / level_requirement / invalid_target / failed_unequip / system_error. 이미 장착한 악기를 요청하면 accepted.
**`stop_action`** — 연주·의자 앉기·자동 진행·운반·채집 정지. 게임에 정지 버튼이 보일 때만(`invalid_state`, `timeout`).
**`stand_up`** — `/앉기` 해제(`not_sitting`, `no_control_object`, `timeout` — 앉는 모션 직후엔 잠시 뒤 재시도).

## 공통 패턴

- **DisplayName 체이닝**: 조회가 돌려준 이름을 실행 명령에 글자 그대로 넘긴다.
- **`blocked` + `kind`**: 사용자 입력이 필요한 UI/상태에서 즉시 멈춘다. 자동으로 넘기지 말고 사용자에게 알린 뒤 기다린다.
- **비용**: 부족하면 `not_enough_currency`, 결제 실패면 `cost_payment_failed`.
- 오류 코드별 조치는 `server/lib/hints.mjs` 에 정리되어 있고, 도구 결과의 `hint` 로 함께 나온다.

## CLI 직접 호출 (MCP 서버를 쓸 수 없을 때의 폴백)

```bash
"/c/Nexon/MabinogiMobile/MabinogiMobile_CLI.exe" status
```

```bash
"/c/Nexon/MabinogiMobile/MabinogiMobile_CLI.exe" get_currencies
```

- 한글 등 비 ASCII 본문은 셸을 거치며 깨지기 쉽다. **본문 전체(UTF-8)를 base64 로 인코딩해 `base64:<값>`** 형식으로 넘긴다(커뮤니티 자료 기준). 예: `{"displayName":"양털"}` → `base64:eyJkaXNwbGF5TmFtZSI6IuyWkeyEuCJ9`
- 프로세스를 셸 없이 직접 띄우는 프로그램(Node `spawn`, Python `subprocess`)은 원문 인자도 동작하는 것으로 보고되어 있다. 이 저장소의 서버는 원문을 먼저 시도하고 실패하면 base64 로 자동 전환한다.
- `status` / `capabilities` / `get_*` 외의 명령은 호출 전에 반드시 사용자 확인. 이 프로젝트의 권한 설정은 CLI 직접 호출을 항상 확인 창으로 띄운다.
