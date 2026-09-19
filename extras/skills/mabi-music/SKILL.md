---
name: mabi-music
description: 마비노기 모바일 연주. 보유 악보·악기 조회, 악기 교체, 악보 연주, 연주 정지. "바람의 노래 연주해줘", "류트로 바꿔줘", "악보 뭐 있어", "연주 멈춰" 같은 요청에 사용.
argument-hint: "<악보 제목> [악기 이름] | 목록 | 정지"
---

# 연주

요청: $ARGUMENTS

## 조회 (무료)

- 악보: `query(get_music_scores, filter:"<제목 일부>")` → `DisplayTitle`, `Location`(inventory / account_storage / character_storage), `IsLocked`
- 악기: `query(get_instruments)` → `Name`, `Durability`, `IsEquipped`
- 현재 연주 상태: `query(get_activity)` 의 `Performance`(곡명, 경과/남은 초, 반복 여부)

## 연주

1. 제목을 정확히 확정한다(부분일치 후보가 여럿이면 질문). 같은 제목의 악보가 여러 개면 게임이 그중 하나를 연주한다.
2. 장착 악기가 없으면(`IsEquipped` 가 모두 false) 어떤 악기로 할지 묻거나, 사용자가 지정한 악기를 `instrument` 로 함께 넘긴다. 내구도 0 인 악기는 피한다.
3. `play_music(title:"<DisplayTitle>", instrument:"<선택>")`
4. 연주는 **주변 모험가에게 들리는 공개 행동**이다. 마을 한복판 등에서 반복 재생을 요청받으면 한 번 짚어 준다.
5. 결과의 `wings.spentNow` 를 확인한다. 카탈로그에는 연주 비용 표기가 없지만 공식 가이드는 연주를 "활동"으로 분류한다 — 0 이 아니면 사용자에게 알리고 `docs/field-notes.md` 에 기록한다.

## 악기 교체 / 정지

- `change_instrument(name)` — 연주 중이면 `is_playing_instrument` → `stop_action` 후 교체.
- 정지: `stop_action`. 멈출 것이 없으면 `invalid_state`.
- `/앉기` 로 앉아 있는 상태는 `stand_up`(의자에 앉은 것은 `stop_action`).

## 오류

| 코드 | 대응 |
|---|---|
| `no_instrument` | 악기 장착 필요 → `instrument` 지정 |
| `not_available_on_combat` / `_riding` / `_dead` | 전투·탑승·행동불능 해제 후 |
| `level_requirement` | 악기 레벨 조건 미달 |
| `not_found` | 제목/이름 불일치 → 후보(`candidates`) 중에서 확인 |
