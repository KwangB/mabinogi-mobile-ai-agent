---
name: mabi-briefing
description: 마비노기 모바일 접속 브리핑. 캐릭터 상태·위치·재화(정령의 날개)·가공 대기열·일일/주간 미션을 한 번에 요약한다. "지금 상태 어때", "오늘 뭐 남았어", "브리핑" 같은 요청이나 세션을 시작할 때 사용. 조회만 하므로 비용이 없다.
argument-hint: "[weekly|quests 등 추가로 보고 싶은 것]"
---

# 접속 브리핑 (무료 · 조회 전용)

추가 요청: $ARGUMENTS

## 절차

1. `status` — 연결 확인. `connected:false` 면 `hint` 를 전달하고 중단(→ `/mabi-doctor` 안내). `capabilities.newCommands`/`missingCommands` 가 있으면 브리핑 끝에 "게임 패치로 명령이 바뀜"을 알린다.
2. `snapshot` — `sections: ["environment","me","currencies","activity","altering","daily","weekly"]`. 사용자가 퀘스트를 물었으면 `"quests"` 추가.
3. 아래 형식으로 요약한다. 값이 없는 줄은 생략.

## 출력 형식 (표시 이름은 게임이 준 그대로)

```
📍 <GameSpaceDisplayName> · <ChannelDisplayName> · 날씨 <Weather> · 에린 시각 <ErinnNow>
🧙 Lv.<레벨> <직업> · 전투력 <..> / 생활력 <..> / 매력 <..>
❤️ 체력 <cur>/<max> · 포만감 <..>% · 가방 <cur>/<max> (<여유 %>)
🪽 정령의 날개 <N>개 → 활동 <N÷5 내림>회분 · 세션 예산 <남음>/<전체>
🧵 가공: 완료 <n>건(수령 가능) / 진행 <n>건(가장 빠른 것 <분>분 뒤)
📋 일일 미션 <남은 수>/<전체> — <미완료 제목: 진행도> …
📅 주간 미션 <남은 수>/<전체> — …
⚠️ 지금 하고 있는 행동: <activity 가 idle 이 아니면 요약>
```

## 마무리 제안 (실행하지 말고 제안만)

- 가공 완료 건이 있으면: "수령해 올까요? (`collect_altered`)"
- 포만감이 낮거나 가방이 90% 이상이면 한 줄 경고(정리는 사용자가 직접).
- 정령의 날개가 하한(`wings.reserve`) 근처면 "활동을 맡기기 어려운 잔액"이라고 알린다.
- 미션 중 채집·제작으로 진행 가능한 것이 보이면 비용과 함께 제안하되, **사용자가 요청하기 전에는 어떤 활동도 시작하지 않는다.**
