---
name: mabi-craft
description: 마비노기 모바일 특정 제작·가공 돌리기와 재료 계획. "○○ 10개 만들어줘", "가공 받아 와", "○○ 만들려면 뭐가 필요해?" 같은 요청에 사용. 제작은 호출당 정령의 날개 5개.
argument-hint: "<레시피 이름> [개수] | 가공 수령 | 재료 계획"
---

# 제작 · 가공 돌리기

요청: $ARGUMENTS

## A. 제작
1. **레시피 확정(무료 1번):** `query(get_craftable_items, filter:"<키워드>")` — 재료 이름으로도 검색된다. 없으면 가공 레시피일 수 있다 → `query(get_alterable_items, filter)`.
2. **횟수 환산:** 사용자가 말한 "N개"는 결과물 수다. `craftCount = ⌈N ÷ ProducedPerCraft⌉`. 환산 결과를 말해 준다.
3. **비용 고지:** 호출당 5개이고 횟수와 무관 → **한 호출에 전부 묶는다.** 예: `가는 실 뭉치 10개 = 제작 5회 → 1회 호출 · 정령의 날개 5개 (209 → 204)`
4. `craft(displayName, craftCount)` → `running` 이면 `job(action:"wait")`(그 사이 말하지 않는다). `invalid_count` 면 `maxCount` 단위로 나누고 늘어난 비용을 다시 알린다.
5. **보고:** `rewards`(대성공은 `criticalRewards`) · 쓴 날개 · 남은 날개. 재료 소모는 되돌릴 수 없으니 귀해 보이는 재료가 들어가면 실행 전에 한 번 확인한다.

`Craftable:false` 일 때: `not_enough_ingredient` → 아래 C(재료 계획) / 스킬·시설·데코 점수 부족 → AI 가 해결 불가, 조건만 알려 준다 / `ingredient_locked` → 사용자가 잠금 해제.

## B. 가공 (시설 대기열)
- **수령(권장):** `collect_altered()` — 한 번에 한 시설의 완료분 전부. `remainingCompleted > 0` 이면 반복. 진행 확인은 `query(get_altering_works)` → "○○ <분>분 남음".
- **등록:** `alter(displayName)` 은 **1건당 5개**라 날개 효율이 나쁘고, 가공은 생활 경험치도 주지 않는다. 여러 건이면 "게임에서 직접 거는 게 이득이에요"라고 먼저 권하고, 그래도 원하면 총비용(5×N)을 알린 뒤 한 건씩 호출한다. 등록 후 완료를 기다리거나 주기적으로 확인하지 않는다.
- `requires_user_interaction` → 그 레시피는 게임에서 직접 시작해야 한다.

## C. 재료 계획 (실행 없음 · 무료)
1. 목표 레시피의 `MissingIngredients`(필요/보유)를 표로 보여 준다. `Required` 는 1회 기준일 수 있으니 "1회 기준 × 횟수"로 계산했다고 밝힌다.
2. 부족 재료마다 출처를 **필요한 것만** 조회한다(각각 `filter` 사용): 보유 `get_items` → 제작 `get_craftable_items` → 가공 `get_alterable_items` → 채집 `get_gatherable_items`. 2단계까지만 내려가고, 조회가 8번을 넘으면 중간 결과를 보여 주고 계속할지 묻는다.
3. 목록에 없는 재료는 "사냥·구매 등 다른 경로"라고만 말한다(드롭처·시세를 지어내지 않는다).
4. 마지막에 **호출 수 × 5 = 예상 날개**를 합산해 보여 주고, 진행할지 묻고 멈춘다. 승인받아도 단계가 끝날 때마다 보고하고 다음 단계를 확인받는다.
