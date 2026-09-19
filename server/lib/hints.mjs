// CLI 오류 코드 → 의미와 사용자 조치. capabilities(2026-09-17) 에 명시된 코드 기준.
// 에이전트가 오류를 추측으로 해석하지 않도록 결과에 그대로 덧붙인다.

export const ERROR_HINTS = {
  // --- 공통: 실행 중단 ---
  blocked:
    '게임 화면에 사용자 입력이 필요한 UI/상태가 떠 있어 멈췄습니다(kind 참고). 자동으로 넘기거나 재시도하지 말고, 사용자에게 게임 화면에서 직접 해결해 달라고 요청한 뒤 확인을 받고 재시도하세요. 1시간 연속 사용 확인 팝업도 여기에 해당합니다.',
  timeout: '제한 시간 안에 끝나지 않아 동작이 중단되었습니다. query 로 현재 상태(get_activity, get_items)를 확인한 뒤 사용자에게 보고하세요.',
  canceled: '다른 명령이 이 동작을 대체하면서 취소되었습니다. 동시에 두 활동을 시키지 마세요.',
  stopped_by_user: '사용자가 게임에서 직접 중단했습니다. 새로 생산된 것은 없을 수 있습니다. 재시도 전 사용자 의사를 확인하세요.',

  // --- 비용 ---
  not_enough_currency: '정령의 날개가 부족합니다(활동 1회당 5개). 일일 미션 등으로 획득 가능. 사용자에게 알리고 중단하세요.',
  cost_payment_failed: '정령의 날개 결제에 실패했습니다. 잠시 후 사용자 확인을 받고 재시도하세요.',

  // --- 채집 ---
  not_found: '이름이 정확히 일치하는 항목이 없습니다. 추측하지 말고 해당 get_* 조회 결과의 DisplayName 을 그대로 사용하세요.',
  no_route: '채집 지점까지 갈 수 있는 경로가 없습니다. 현재 위치/지역을 사용자와 확인하세요.',
  insufficient_living_skill_level: '생활 스킬 레벨이 부족합니다(필요 레벨은 message 참고). 에이전트가 해결할 수 없습니다.',
  overweight: '가방 무게 초과입니다. 보관함 정리/판매는 사용자가 직접 해야 합니다(에이전트는 아이템을 버리거나 분해할 수 없음).',
  tool_missing:
    '쓸 수 있는 채집 도구가 없습니다(없거나 전부 내구도 0). 커넥터에는 수리·구매·이동 명령이 없으므로 사용자가 직접 수리하거나 구매해야 합니다. 팁: 게임은 내구도가 다 닳으면 가방의 다른 도구로 자동 교체하므로, 저렴한 여분 도구를 넉넉히(도구 가방에 넣으면 무게 0) 챙겨 두면 끊기지 않습니다. 제작 가능한 도구라면 제작을 제안할 수 있습니다.',
  tool_broken:
    '채집 도중 도구 내구도가 0이 되어 멈췄습니다(가방에 교체할 여분 도구도 없었다는 뜻). 획득량을 보고하고, 사용자가 수리하거나 여분 도구를 마련한 뒤 재개하세요. 같은 요청을 바로 재시도하지 마세요(정령의 날개만 다시 나갑니다). 화면 조작·매크로로 수리를 대신하지 않습니다.',
  required_consumable_missing: '채집에 필요한 소모품(예: 빈 병)이 없습니다. 사용자가 준비해야 합니다.',
  not_in_field: '현재 필드가 아닙니다(던전/마이홈/특수 지역 등). 사용자가 필드로 나온 뒤 재시도하세요.',

  // --- 제작/가공 ---
  crafting_locked: '제작 시스템이 아직 해금되지 않았습니다.',
  not_available: '지금은 이 레시피를 진행할 수 없습니다(message 참고).',
  requires_user_interaction: '이 레시피는 커넥터로 등록할 수 없습니다. 사용자가 게임에서 직접 시작해야 합니다.',
  invalid_count: 'craftCount 가 시설 상한을 넘었습니다. 응답의 maxCount 이하로 나눠서 요청하세요(호출마다 날개 5개).',
  insufficient_facility_level: '시설 레벨이 부족합니다.',
  insufficient_decor_score: '데코 점수가 부족합니다.',
  not_enough_ingredient: '재료가 부족합니다(MissingIngredients 참고). 부족분을 먼저 채집/가공할지 사용자와 상의하세요.',
  ingredient_locked: '재료가 잠금 상태입니다. 사용자가 잠금을 풀어야 합니다.',
  insufficient_transfer_cost: '재료 전송 비용이 부족합니다.',
  facility_not_found: '해당 시설을 찾지 못했습니다.',
  component_not_found: '시설 UI 구성요소를 찾지 못했습니다. 잠시 후 재시도하거나 사용자에게 상황을 알리세요.',
  no_altering: '진행 중인 가공 작업이 없습니다.',
  no_completed_work: '수령할 완료 작업이 없습니다.',
  no_completed_work_at_facility: '그 시설에는 완료된 작업이 없습니다.',
  not_completed_yet: '해당 작업이 아직 진행 중입니다. get_altering_works 의 RemainingSeconds 를 확인하세요.',

  // --- 연주 ---
  no_instrument: '장착한 악기가 없습니다. change_instrument 로 먼저 장착하세요.',
  is_playing_instrument: '연주 중에는 악기를 바꿀 수 없습니다. stop_action 후 시도하세요.',
  not_available_on_combat: '전투 중에는 할 수 없습니다.',
  not_available_on_riding: '탈것 탑승 중에는 할 수 없습니다.',
  not_available_on_dead: '행동 불능 상태에서는 할 수 없습니다.',
  level_requirement: '레벨 조건을 만족하지 못했습니다.',
  invalid_target: '대상이 올바르지 않습니다.',
  failed_unequip: '기존 악기 해제에 실패했습니다.',
  system_error: '게임 내부 오류입니다. 반복되면 사용자에게 알리세요.',

  // --- 정지/일어서기 ---
  invalid_state: '지금 멈출 수 있는 동작이 없습니다(게임의 정지 버튼이 보일 때만 동작). /앉기 상태라면 stand_up 을 쓰세요.',
  not_sitting: '앉아 있는 상태가 아닙니다.',
  no_control_object: '조작할 캐릭터를 찾지 못했습니다. 게임 월드에 접속해 있는지 확인하세요.',

  // --- 채팅 ---
  rate_limited: '채팅 속도 제한에 걸렸습니다. retryAfterSeconds 만큼 기다리세요. 반복 전송은 도배로 제재될 수 있습니다.',
  unsupported_command: "'/' 또는 '#' 예약 명령은 보낼 수 없습니다. 행동은 get_social_actions 의 ChatCommands 값만 가능합니다.",
  message_too_long: '채팅은 최대 50자입니다.',

  // --- 래퍼(이 서버)가 만드는 코드 ---
  cli_not_found:
    '공식 CLI(MabinogiMobile_CLI.exe)를 찾지 못했습니다. AI 커넥터는 Windows PC 버전 전용입니다. 기본 경로 C:\\Nexon\\MabinogiMobile\\ 가 아니면 .mcp.json 의 MABINOGI_CLI_PATH 에 경로를 지정하세요.',
  not_connected:
    '게임과 연결되지 않았습니다. ① PC 버전 게임 실행 후 캐릭터로 월드 접속(로그인/캐릭터 선택 화면에서는 동작 안 함) ② [메뉴(≡)]→[환경 설정]→[게임]→[AI 제어]→[마비노기 모바일 AI 커넥터(Beta)] 토글 ON(7일간 미사용 시 자동 OFF) 을 사용자에게 확인 요청하세요.',
  capabilities_loading: '명령 카탈로그가 아직 준비되지 않았습니다(loading: true). 사용자가 게임 월드에 들어간 뒤 다시 조회하세요.',
  empty_response: 'CLI 가 아무것도 출력하지 않았습니다. 게임이 실행 중인지 확인하세요.',
  invalid_json: 'CLI 출력이 JSON 이 아닙니다. raw 필드를 사용자에게 보여 주세요.',
  daily_budget_exceeded: '오늘(06시 기준) AI 가 쓸 수 있는 정령의 날개 상한에 도달했습니다. 사용자가 .mcp.json 의 MABI_WINGS_DAILY_BUDGET 을 올리기 전에는 실행하지 않습니다. 에이전트가 우회하면 안 됩니다.',
  bag_nearly_full: '가방이 거의 찼습니다. 사용자가 판매·보관으로 가방을 비운 뒤 다시 요청하세요(에이전트는 아이템을 버리거나 분해할 수 없음).',
  recent_failure: '직전에 비용을 쓰고 중단된 활동입니다. 원인(previous/previousKind)을 사용자에게 알리고, 해결됐다고 확인받은 뒤에만 retryAfterFix:true 로 다시 호출하세요.',
  budget_exceeded: '이 세션의 정령의 날개 예산을 모두 썼습니다. 더 쓰려면 사용자가 .mcp.json 의 MABI_WINGS_SESSION_BUDGET 을 올리고 서버를 재시작해야 합니다. 에이전트가 우회하면 안 됩니다.',
  reserve_protected: '실행하면 정령의 날개 잔액이 보호 하한(MABI_WINGS_RESERVE) 아래로 내려갑니다. 사용자가 설정을 바꾸기 전에는 실행하지 않습니다.',
  busy: '이미 진행 중인 활동이 있습니다. job(action:"wait") 로 끝나길 기다리거나, 사용자가 원하면 stop_action 으로 멈춘 뒤 새 활동을 시작하세요.',
  approval_required: '채팅은 사용자가 이 문구를 그대로 확인·승인한 경우에만 보낼 수 있습니다. 문구를 보여 주고 승인을 받은 뒤 approvedByUser:true 로 다시 호출하세요.',
  chat_throttled: '도배 방지를 위해 채팅 간 최소 간격을 두고 있습니다. retryAfterSeconds 후 다시 시도하세요.',
  unknown_command: '현재 게임의 capabilities 에 없는 명령입니다. status(refreshCapabilities:true) 로 목록을 확인하세요.',
};

export function hintFor(code) {
  if (!code) return undefined;
  return ERROR_HINTS[String(code)] || undefined;
}
