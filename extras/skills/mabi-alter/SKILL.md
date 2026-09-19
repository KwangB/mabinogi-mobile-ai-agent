---
name: mabi-alter
description: 마비노기 모바일 가공(추출물·포자·가루·실·목재 등 시설 대기열 방식 생산) 등록, 진행 확인, 완료품 수령. "가공 걸어줘", "가공 다 됐어?", "완성된 거 받아와" 같은 요청에 사용. 등록은 1건당 정령의 날개 5개.
argument-hint: "<가공 레시피 이름> [건수] | 진행 | 수령"
---

# 가공: 등록 · 진행 확인 · 수령

요청: $ARGUMENTS

가공은 제작과 달리 **비동기 대기열**이다. 등록(`alter`) → 시간 경과 → 수령(`collect_altered`).

## A. 진행 확인 (무료)

`query(get_altering_works)` → 시설(`FacilityName`)별로 묶어서:
`<시설> — <DisplayName>: 완료 ✅ | 진행 중 <RemainingSeconds÷60 올림>분 남음`
`completedCount > 0` 이면 수령을 제안한다.

## B. 수령

1. `collect_altered()` — displayName 을 생략하면 완료된 첫 작업의 시설에서 **그 시설의 완료 작업 전부**를 받는다.
2. 응답의 `remainingCompleted > 0` 이면 다른 시설에 완료품이 남은 것 → 시설마다 한 번씩 반복 호출.
3. 카탈로그에 비용 표기는 없다. 서버가 전후 잔액을 실측하므로 `wings.spentNow` 가 0 이 아니면 그 사실을 사용자에게 알리고 `docs/field-notes.md` 에 기록한다.
4. `not_completed_yet` → 남은 시간을 알려 준다. `overweight` → 가방 정리는 사용자가 직접.

## C. 등록

1. `query(get_alterable_items, filter:"<키워드>")` — 레시피명·재료명 모두 검색된다. 정확한 `DisplayName` 확정.
2. `Alterable:false` → `Reason` / `MissingIngredients` 안내(`not_enough_ingredient`, `insufficient_facility_level`, `ingredient_locked`, `insufficient_transfer_cost`). 부족 재료는 `/mabi-plan` 으로 계획 제안.
3. **비용 고지: 등록 1건 = 호출 1회 = 정령의 날개 5개.** N건이면 5×N개이고 확인 창도 N번 뜬다. 결과물 수 = N × `ProducedPerWork`.
   예: `가는 실 3건(15개) 등록 → 호출 3회 · 정령의 날개 15개 (204 → 189)`
4. `alter(displayName)` 을 건수만큼 **하나씩** 호출. 각 호출은 `result:"started"` 를 확인한 뒤 다음으로. 중간에 실패하면 멈추고 보고.
5. 등록 후 `query(get_altering_works)` 로 예상 완료 시간을 알려 주고 끝낸다. **완료될 때까지 기다리거나 주기적으로 확인하지 않는다**(사용자가 나중에 "가공 다 됐어?"라고 물으면 그때 확인).

## 오류

| 코드 | 대응 |
|---|---|
| `requires_user_interaction` | 이 레시피는 커넥터로 등록 불가 → 게임에서 직접 시작하도록 안내 |
| `blocked` + `kind` | 사용자 해결 대기 |
| `result:"stopped_by_user"` | 시설 도착 전 사용자가 이동을 멈춤 |
| `facility_not_found` / `not_in_field` | 위치 확인 요청 |
