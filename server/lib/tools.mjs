// MCP 도구 정의 + 처리기.
// 설계 원칙
//  1) 조회(query/snapshot/status/job)는 무료·무해 → 자동 허용해도 안전하도록 분리
//  2) 정령의 날개가 나가는 활동(gather/craft/alter)과 채팅(chat)은 별도 도구 → 권한 설정에서 "항상 확인(ask)" 가능
//  3) 이름은 추측하지 않는다: 실행 전에 조회로 정확히 일치하는 DisplayName 을 검증(무료)하고 나서 비용을 쓴다
//  4) blocked/1시간 확인/채팅 승인 같은 게임의 안전장치는 절대 우회하지 않고 그대로 사용자에게 전달한다
import { hintFor } from './hints.mjs';
import * as shape from './shape.mjs';
import { HomeworkStore, renderBoard, humanMinutes, normalize as normalizeText } from './homework.mjs';

export const SERVER_NAME = 'mabinogi';
export const SERVER_VERSION = '0.1.0';
export const CATALOG_DATE = '2026-09-17';

export const QUERY_COMMANDS = [
  'get_current_environment', 'get_activity', 'get_my_info', 'get_currencies', 'get_inventory', 'get_items',
  'get_quests', 'get_daily_missions', 'get_weekly_missions', 'get_near_npcs', 'get_near_pcs',
  'get_gatherable_items', 'get_craftable_items', 'get_alterable_items', 'get_altering_works',
  'get_music_scores', 'get_instruments', 'get_social_actions', 'capabilities',
];
export const ACTION_COMMANDS = [
  'write_chat', 'play_music_score', 'change_instrument', 'stop_action', 'stand_up',
  'execute_gathering', 'execute_altering', 'complete_altering_work', 'execute_crafting',
];
export const KNOWN_COMMANDS = [...QUERY_COMMANDS, ...ACTION_COMMANDS];

// 서버 쪽 부분일치 필터(원문 문자열 본문)를 지원하는 조회
const RAW_FILTER_COMMANDS = new Set([
  'get_music_scores', 'get_instruments', 'get_social_actions', 'get_gatherable_items', 'get_alterable_items', 'get_craftable_items',
]);
const SNAPSHOT_SECTIONS = ['environment', 'me', 'stats', 'currencies', 'activity', 'altering', 'daily', 'weekly', 'quests', 'gear'];
const LOW_DURABILITY = 10;
const DEFAULT_SNAPSHOT = ['environment', 'me', 'currencies', 'activity', 'altering', 'daily'];
const GENERIC_HINT = '알 수 없는 오류 코드입니다. message 를 사용자에게 그대로 전달하고, status 도구로 연결 상태를 확인하세요. 추측으로 재시도하지 마세요.';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const RO = { readOnlyHint: true };
const ACT = { readOnlyHint: false };
const NAME_RULE = '이름은 해당 query 결과의 값과 글자 그대로 일치해야 한다.';

// core = 초보자 4대 목적(숙제 · 생활 레벨업 · 채집/제작 돌리기 · 모험가 길드 정기 의뢰)에 필요한 도구만.
// 나머지는 MABI_PROFILE=full 일 때만 노출한다(도구 정의는 매 요청 컨텍스트에 실리므로 줄일수록 토큰이 준다).
export const CORE_TOOLS = new Set(['status', 'query', 'snapshot', 'gather', 'craft', 'alter', 'collect_altered', 'stop_action', 'job', 'homework', 'plan_craft']);

export const TOOLS = [
  {
    name: 'status',
    title: '연결 확인',
    description: '게임 연결·명령 변동·정령의 날개 예산·진행 중 작업 확인(무료). 세션 첫 호출. 문제가 있으면 hint 의 조치를 사용자에게 전달.',
    inputSchema: { type: 'object', properties: { refreshCapabilities: { type: 'boolean', description: '명령 카탈로그 다시 읽기' } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'query',
    title: '조회(무료)',
    description:
      '읽기 전용 조회(무료). 실행 도구에 넘길 이름은 여기서 받은 DisplayName/DisplayTitle/Name 을 글자 그대로 쓴다(추측 금지). 목록형은 filter(부분일치)를 꼭 건다. 자주 쓰는 것: get_gatherable_items(채집 가능+ToolOk) · get_craftable_items/get_alterable_items(가능 여부·MissingIngredients, 재료명으로도 검색) · get_items(소지 재료·소모품) · get_currencies · get_altering_works(가공 대기열) · get_quests · capabilities(명령 카탈로그=최종 기준).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: QUERY_COMMANDS },
        filter: { type: 'string', description: '이름 부분일치' },
        category: { type: 'string', description: 'get_items 전용. 예: Ingredient, Food, Consumable' },
        onlyActionable: { type: 'boolean', description: '지금 가능한 것만(제작/가공 가능, 도구 OK, 미완료 미션 등)' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: '최대 행 수(기본 25)' },
        compact: { type: 'boolean', description: 'false = 원본 그대로' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: 'snapshot',
    title: '상태 요약(무료)',
    description: '여러 조회를 한 번에 묶은 요약(무료). query 를 여러 번 부르는 것보다 싸다. 기본: environment, me, currencies, activity, altering, daily.',
    inputSchema: {
      type: 'object',
      properties: { sections: { type: 'array', items: { type: 'string', enum: SNAPSHOT_SECTIONS }, description: 'me=레벨·직업·체력·포만감·가방무게 / stats=전체 능력치 / gear=쓸 도구가 없는 채집물·악기 내구도' } },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: 'gather',
    title: '채집 (날개 5)',
    description:
      '[호출당 정령의 날개 5] 지정한 아이템이 100개가 될 때까지 채집(가장 가까운 채집지로 자동 이동). 비용은 수량과 무관 → 잘게 쪼개 부르지 않는다. 같은 채집지의 다른 드롭은 세지 않으므로 희귀 드롭을 지정하면 같은 비용으로 더 오래 채집한다. 낚시 전용 항목은 자동 낚시를 켜고 바로 반환(스스로 안 끝남 → stop_action). 이름·도구·가방·잔액은 서버가 무료로 사전 점검한다. blocked 면 kind 를 사용자에게 전하고 기다린다. 끝나면 newGatherables(새로 열린 채집물)로 생활 레벨 상승 여부를 알 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: `get_gatherable_items 의 DisplayName. ${NAME_RULE}` },
        stopAtCount: { type: 'integer', minimum: 1, maximum: 99, description: '(실험적) 이만큼 모이면 조기 종료. 약간 초과될 수 있음' },
        retryAfterFix: { type: 'boolean', description: '직전 실패(recent_failure)의 원인을 사용자가 해결했다고 확인했을 때만 true' },
        waitSec: { type: 'integer', minimum: 1 },
      },
      required: ['displayName'],
      additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'craft',
    title: '제작 (날개 5)',
    description:
      '[호출당 정령의 날개 5] 제작(시설 이동+제작+수령). craftCount 는 "제작 횟수"(결과물 수 = 횟수×ProducedPerCraft). 비용은 횟수와 무관 → 필요한 만큼 한 호출에 묶는다. 상한 초과 시 invalid_count+maxCount. 레시피·재료는 서버가 무료로 사전 점검한다.',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: `get_craftable_items 의 DisplayName. ${NAME_RULE}` },
        craftCount: { type: 'integer', minimum: 1, description: '제작 횟수(기본 1)' },
        retryAfterFix: { type: 'boolean' },
        waitSec: { type: 'integer', minimum: 1 },
      },
      required: ['displayName'],
      additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'alter',
    title: '가공 등록 (날개 5)',
    description:
      '[호출당 정령의 날개 5] 가공 1건을 시설 대기열에 등록(비동기: 완성은 나중에 collect_altered 로 수령). N건 = N호출 = 5×N개라 날개 효율이 나쁘고 가공은 생활 경험치도 없다 → 여러 건이면 게임에서 직접 거는 편을 권하고, 총비용을 먼저 알린다.',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: `get_alterable_items 의 DisplayName. ${NAME_RULE}` },
        retryAfterFix: { type: 'boolean' },
        waitSec: { type: 'integer', minimum: 1 },
      },
      required: ['displayName'],
      additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'collect_altered',
    title: '가공 수령',
    description: '완료된 가공품 수령(한 번에 한 시설의 완료분 전부, 시설 이동 포함). displayName 생략 시 완료된 첫 작업. 여러 시설이면 remainingCompleted 가 0이 될 때까지 반복.',
    inputSchema: { type: 'object', properties: { displayName: { type: 'string', description: 'get_altering_works 의 DisplayName' }, waitSec: { type: 'integer', minimum: 1 } }, additionalProperties: false },
    annotations: ACT,
  },
  {
    name: 'play_music',
    title: '악보 연주',
    description: '보유 악보 연주(주변에 들리는 공개 행동). 장착 악기가 없으면 instrument 를 함께 준다. 멈출 때는 stop_action.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'get_music_scores 의 DisplayTitle' }, instrument: { type: 'string', description: 'get_instruments 의 Name(선택)' } },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'change_instrument',
    title: '악기 교체',
    description: '보유 악기 장착. 연주 중에는 stop_action 먼저.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'get_instruments 의 Name' } }, required: ['name'], additionalProperties: false },
    annotations: ACT,
  },
  {
    name: 'stop_action',
    title: '정지',
    description: '진행 중인 채집·자동 낚시·연주 등을 정지(무료). 사용자가 "그만/멈춰"라고 하면 즉시 호출.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ACT,
  },
  {
    name: 'stand_up',
    title: '일어서기',
    description: '/앉기 상태 해제.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ACT,
  },
  {
    name: 'chat',
    title: '채팅·행동·표정',
    description:
      '일반 채팅 또는 행동(ChatCommands)·표정(EmojiText) 실행. 50자 이내, AI 아이콘이 붙는 공개 행동. 보낼 문구를 사용자에게 먼저 보여 주고 그대로 승인받았을 때만 approvedByUser:true. 반복·도배 금지, rate_limited 면 retryAfterSeconds 대기.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, approvedByUser: { type: 'boolean' } },
      required: ['message', 'approvedByUser'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'job',
    title: '작업 대기(무료)',
    description: '활동이 running 으로 돌아왔을 때 이어서 기다린다. action: wait | status | list. wait 사이에는 사용자에게 아무 말도 하지 않는다(토큰 절약).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['wait', 'status', 'list'] }, jobId: { type: 'string' }, waitSec: { type: 'integer', minimum: 1 } },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: 'homework',
    title: '숙제·정기 의뢰(무료)',
    description:
      '일일/주간 숙제 체크리스트(무료, 게임에 영향 없음). 초기화(매일 06:00·월요일 06:00 KST)는 서버가 계산한다. 횟수 = 전리품을 받을 수 있는 횟수 → 다 받은 것은 완료이고 기본 목록에는 남은 것만 나온다. action: list(보드. 게임이 켜져 있으면 일일/주간 미션·정기 의뢰 자동 반영) | check(+1, all:true=끝까지) | uncheck | set | plan(모험가 길드 정기 의뢰: 실제 진행도+내 공략 설정+재화 소모 계산) | guide(어비스·레이드 안내. 체크 대상 아님) | enable/disable | add/remove | characters. item 은 이름·별칭 부분일치(검구, 결계 …), 여러 개면 candidates. group 은 그룹명 또는 "preset:shop|barter|event|legacy|raid-abyss".',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'check', 'uncheck', 'set', 'sync', 'plan', 'guide', 'enable', 'disable', 'add', 'remove', 'characters'] },
        item: { type: 'string' },
        group: { type: 'string' },
        count: { type: 'integer', minimum: 0, description: 'check/uncheck 증감량 · set 절대값 · add 목표 횟수' },
        all: { type: 'boolean' },
        character: { type: 'string', description: '캐릭터 프로필(사용자가 붙인 별명)' },
        cycle: { type: 'string', enum: ['all', 'daily', 'weekly'] },
        pendingOnly: { type: 'boolean', description: '기본 true(남은 것만)' },
        detail: { type: 'boolean', description: 'true = id·설명까지 구조화해서' },
        sync: { type: 'boolean', description: 'false = 게임 조회 없이 기록만' },
        name: { type: 'string', description: 'add 용' },
        scope: { type: 'string', enum: ['character', 'account'] },
        note: { type: 'string' },
        delete: { type: 'boolean', description: 'characters: 프로필 삭제' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'plan_craft',
    title: '재료 계획 (무료)',
    description:
      '제작·가공 목표에 필요한 재료를 부족분까지 따라 내려가 채집 → 가공 → 제작 순서의 실행 계획과 정령의 날개 예상 비용을 만든다(무료, 실행 없음). 재료가 모자란 요청은 먼저 이 도구로 표를 만들어 승인받고 steps 순서대로 gather/alter/craft 를 호출한다. 게임은 재료를 "부족할 때만" 알려 주므로 uncertain 에 적힌 항목은 실행 중 다시 부족해질 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        displayName: { type: 'string', description: `목표 제작법(get_craftable_items) 또는 가공(get_alterable_items)의 DisplayName. ${NAME_RULE}` },
        count: { type: 'integer', minimum: 1, description: '원하는 결과물 개수(기본 1). 제작 횟수가 아니라 개수' },
      },
      required: ['displayName'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'raw_call',
    title: '신규 명령 호출',
    description: '패치로 capabilities 에 새로 생겨 전용 도구가 없는 명령만 호출한다(기존 실행형 명령은 거부). 먼저 query(capabilities, compact:false, filter) 로 사양을 읽는다. requiresConfirm 명령은 사용자 승인 후 approvedByUser:true.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, body: { type: ['string', 'object'] }, approvedByUser: { type: 'boolean' } },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
];

export function createToolset(ctx) {
  const { config, cli, wings, chatGuard, jobs } = ctx;
  const caps = { commands: null, loading: false, fetchedAt: 0 };
  const fixedNow = config.nowOverride ? Date.parse(config.nowOverride) : NaN;
  const homeworkStore = new HomeworkStore({
    dataDir: config.homeworkDir,
    fallbackDefsPath: config.defaultHomeworkDefs,
    now: Number.isFinite(fixedNow) ? () => fixedNow : () => Date.now(),
  });

  // ------------------------------------------------------------ helpers
  const isSuccess = (res) => res.transportOk && (res.status === 'accepted' || res.status === 'unknown') && !res.errorCode;

  const fail = (code, message, extra = {}) => ({ ok: false, error: code, message, hint: hintFor(code) ?? GENERIC_HINT, ...extra });
  // 숙제 트래커용: 게임 오류 힌트(not_found 등)가 엉뚱하게 붙지 않도록 분리
  const hwFail = (code, message, extra = {}) => ({ ok: false, error: code, message, ...extra });

  function fromCliFailure(res, extra = {}) {
    const body = isPlainObject(res.body) ? res.body : res.body === undefined ? {} : { value: res.body };
    const code = res.errorCode || (res.status !== 'accepted' && res.status !== 'unknown' ? res.status : undefined);
    const out = { ok: false, status: res.status, ...body, hint: hintFor(code) ?? GENERIC_HINT, ...extra };
    if (res.raw) out.raw = res.raw;
    return out;
  }

  const wingsView = (settled) => {
    const s = wings.summary();
    const out = { spentNow: settled.spent, balanceAfter: settled.balanceAfter, session: s.session };
    if (s.today) out.today = s.today;
    if (!settled.measured) out.estimated = true; // 잔액을 못 읽어 추정한 값
    return out;
  };

  // 날개 낭비 방지용 상태: 비용이 나간 뒤 중단된 마지막 활동
  let lastChargedFailure = null;

  async function getBagPercent() {
    const res = await cli.call('get_inventory');
    if (!isSuccess(res) || !isPlainObject(res.body)) return null;
    const cur = toNumber(res.body.CurrentInventoryWeightAsDecimal ?? res.body.CurrentInventoryWeight);
    const max = toNumber(res.body.MaxInventoryWeightAsDecimal ?? res.body.MaxInventoryWeight);
    if (cur === null || max === null || max <= 0) return null;
    return Math.round((cur / max) * 100);
  }

  function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  async function getWingsBalance() {
    const res = await cli.call('get_currencies');
    if (!isSuccess(res)) return null;
    const rows = shape.extractRows(res.body)?.rows;
    if (!rows) return null;
    const row = rows.find((r) => isPlainObject(r) && r.DisplayName === config.wingsName);
    return row ? toNumber(row.Amount) : null;
  }

  async function countInBag(displayName) {
    const res = await cli.call('get_items', { name: displayName });
    if (!isSuccess(res)) return null;
    const rows = shape.extractRows(res.body)?.rows;
    if (!rows) return null;
    let sum = 0;
    for (const r of rows) {
      if (!isPlainObject(r) || r.DisplayName !== displayName) continue;
      if (r.Location !== undefined && r.Location !== 'inventory') continue;
      sum += toNumber(r.Count) ?? 0;
    }
    return sum;
  }

  /** 목록 조회 캐시(무료 호출이지만 CLI 프로세스 1회 ≈ 0.5초). 비용이 나가는 활동이 끝나면 invalidateLists() 로 비운다. */
  const listCache = new Map();
  const CACHEABLE_LISTS = new Set(['get_gatherable_items', 'get_craftable_items', 'get_alterable_items']); // 악기·악보 목록은 장착 상태가 바뀌므로 캐시하지 않는다
  const invalidateLists = () => listCache.clear();
  async function fetchList(command, { fresh = false } = {}) {
    const hit = CACHEABLE_LISTS.has(command) ? listCache.get(command) : null;
    if (!fresh && hit && Date.now() - hit.at < config.listCacheSec * 1000) return hit;
    const res = await cli.call(command);
    if (!isSuccess(res)) return { failure: fromCliFailure(res, { during: command }) };
    const ex = shape.extractRows(res.body);
    const entry = { at: Date.now(), rows: (ex?.rows ?? []).filter(isPlainObject), meta: ex?.meta ?? {} };
    if (CACHEABLE_LISTS.has(command)) listCache.set(command, entry);
    return entry;
  }

  /** 지금 캘 수 있는 채집물 이름 전체(무료). 채집 전후를 비교해 새로 열린 채집물(=생활 레벨 상승 추정)을 찾는 데 쓴다. */
  async function listGatherableNames({ fresh = false } = {}) {
    const list = await fetchList('get_gatherable_items', { fresh });
    if (list.failure) return null;
    return new Set(list.rows.filter((r) => typeof r.DisplayName === 'string').map((r) => r.DisplayName));
  }

  /** 조회로 이름이 정확히 일치하는 행을 찾는다(무료). 없으면 후보를 돌려준다. */
  async function resolveExact(command, name, key = 'DisplayName') {
    const list = await fetchList(command);
    if (list.failure) return { failure: list.failure };
    const rows = list.rows;
    const same = rows.filter((r) => r[key] === name);
    // 같은 이름이 여러 줄이면(장신구 SS 등) 지금 가능한 줄 → 재료 부족 줄 → 첫 줄 순으로 고른다
    const exact = same.find((r) => r.Craftable === true || r.Alterable === true || r.ToolOk === true) || same.find((r) => r.Reason === 'not_enough_ingredient') || same[0];
    if (exact) return { row: exact, meta: list.meta };
    const needle = String(name).toLowerCase();
    const candidates = [...new Set(rows.map((r) => r[key]).filter((v) => typeof v === 'string' && v.toLowerCase().includes(needle)))].slice(0, 10);
    return {
      meta: list.meta,
      failure: fail('not_found', `"${name}" 와(과) 정확히 일치하는 항목이 없습니다.`, {
        candidates,
        tip: candidates.length
          ? '후보 중 어느 것인지 사용자에게 확인받고, 그 이름을 글자 그대로 사용하세요.'
          : '더 짧은 키워드로 query 해서 정확한 이름을 찾으세요. 목록에 없다면 생활 스킬 레벨이 부족해 숨겨진 항목일 수 있습니다.',
      }),
    };
  }

  async function loadCapabilities(force = false) {
    if (caps.commands && !force && !caps.loading) return caps;
    const res = await cli.call('capabilities');
    if (!isSuccess(res)) return { ...caps, failure: fromCliFailure(res, { during: 'capabilities' }) };
    const body = res.body;
    const list = Array.isArray(body) ? body : isPlainObject(body) && Array.isArray(body.commands) ? body.commands : [];
    caps.commands = list.filter(isPlainObject);
    caps.loading = isPlainObject(body) && body.loading === true;
    caps.fetchedAt = Date.now();
    return caps;
  }

  function capabilityDrift() {
    if (!caps.commands) return null;
    const live = new Set(caps.commands.map((c) => c.Command).filter(Boolean));
    const known = new Set(KNOWN_COMMANDS);
    return {
      newCommands: [...live].filter((c) => !known.has(c)),
      missingCommands: [...known].filter((c) => !live.has(c)),
    };
  }

  function actionResult(res, settled, extra = {}) {
    const body = isPlainObject(res.body) ? res.body : res.body === undefined ? {} : { value: res.body };
    const ok = isSuccess(res);
    const code = res.errorCode || (!ok && res.status !== 'accepted' && res.status !== 'unknown' ? res.status : undefined);
    const out = { ok, status: res.status, ...body };
    if (code) out.hint = hintFor(code) ?? GENERIC_HINT;
    if (res.encodingFallback) out.encodingFallback = res.encodingFallback;
    if (settled) out.wings = wingsView(settled);
    return { ...out, ...extra };
  }

  async function waitForJob(reqCtx, job, waitSec) {
    const limit = clamp(Number.isFinite(waitSec) ? waitSec : config.maxWaitSec, 1, config.maxWaitSec);
    let lastSent = 0;
    const done = await jobs.wait(job, limit, {
      signal: reqCtx?.signal,
      onTick: (elapsed) => {
        if (Date.now() - lastSent < 5000) return;
        lastSent = Date.now();
        reqCtx?.progress?.(elapsed, `${job.label} 진행 중 (${elapsed}초)`);
      },
    });
    if (done) return { ...job.result, job: jobs.view(job) };
    return {
      ok: true,
      running: true,
      job: jobs.view(job),
      ...(job.progress ? { progress: job.progress } : {}),
      next: `job(action:"wait") 로 이어서 대기. 그 사이 사용자에게 말하지 말 것. 중단 요청 시 stop_action.`,
    };
  }

  const busyFailure = () => fail('busy', '이미 진행 중인 활동이 있습니다.', { job: jobs.view(jobs.active) });

  /**
   * 비용(정령의 날개)이 드는 활동의 공통 흐름.
   * 날개를 아끼는 순서: ① 직전 실패 재시도 차단 → ② 가방 점검(채집) → ③ 예산·하한·하루 상한 → ④ 실행 → ⑤ 실지출 기록
   * ①~③ 은 전부 무료 조회라 거부돼도 날개가 나가지 않는다.
   */
  async function runCostly(reqCtx, { kind, label, command, body, waitSec, watcherFactory, extra, retryAfterFix, checkBag, finalize }) {
    if (jobs.isBusy()) return busyFailure();
    const key = `${command}:${JSON.stringify(body ?? null)}`;

    if (lastChargedFailure && lastChargedFailure.key === key && retryAfterFix !== true) {
      const ageSec = Math.round((Date.now() - lastChargedFailure.at) / 1000);
      if (ageSec < config.retryGuardSec) {
        return fail('recent_failure', `같은 활동이 ${ageSec}초 전에 비용을 쓴 뒤 "${lastChargedFailure.error}" 로 중단됐습니다. 원인을 해결하지 않고 다시 하면 정령의 날개만 또 나갑니다.`, { previous: lastChargedFailure.error, previousKind: lastChargedFailure.kind });
      }
    }

    let bagPercent = null;
    if (checkBag) {
      bagPercent = await getBagPercent();
      if (bagPercent !== null && config.bagRefusePercent > 0 && bagPercent >= config.bagRefusePercent) {
        return fail('bag_nearly_full', `가방이 ${bagPercent}% 찼습니다. 지금 시작하면 곧바로 무게 초과로 끝나 정령의 날개만 쓰게 됩니다. (날개는 쓰지 않았습니다)`, { bagPercent });
      }
    }

    const before = await getWingsBalance();
    const pre = wings.precheck(before);
    if (!pre.ok) return fail(pre.code, pre.message, { wings: wings.summary() });
    let job;
    try {
      job = jobs.start(kind, label, async (j) => {
        const main = cli.call(command, body, { long: true });
        const watcher = watcherFactory ? watcherFactory(j, main) : null;
        const res = await main;
        const watch = watcher ? await watcher : undefined;
        invalidateLists();
        const after = await getWingsBalance();
        const started = res.transportOk && (res.status === 'accepted' || (res.status === 'unknown' && !res.errorCode));
        const settled = wings.settle({ before, after, started, assumeCost: true });
        const result = actionResult(res, settled, { ...(extra || {}), ...(watch ? { watch } : {}) });
        if (settled.spent > 0 && !result.ok) lastChargedFailure = { key, at: Date.now(), error: result.error || result.status, kind: result.kind };
        else if (result.ok && lastChargedFailure?.key === key) lastChargedFailure = null;
        if (typeof result.gained === 'number' && settled.spent > 0) result.perWing = Math.round((result.gained / settled.spent) * 10) / 10; // 날개 1개당 획득량
        if (bagPercent !== null && bagPercent >= config.bagWarnPercent) result.bagWarning = `시작 시 가방 ${bagPercent}% — 정리하면 같은 비용으로 더 오래 돕니다`;
        if (finalize && result.ok) {
          try { Object.assign(result, (await finalize(result)) || {}); } catch { /* 부가 정보라 본 결과를 깨지 않는다 */ }
        }
        return result;
      });
    } catch {
      return busyFailure();
    }
    return waitForJob(reqCtx, job, waitSec);
  }

  /** 비용 표기가 없는 활동: 보호 장치 없이 실행하되 전후 잔액 차이는 측정해 보고한다. */
  async function runMeasured(command, body, { timeoutSec } = {}) {
    const before = await getWingsBalance();
    const res = await cli.call(command, body, timeoutSec ? { timeoutSec } : {});
    const after = await getWingsBalance();
    const settled = wings.settle({ before, after, started: false, assumeCost: false });
    return { res, settled };
  }

  function makeGatherWatcher(displayName, stopAt, baseline) {
    return (job, main) =>
      (async () => {
        let settled = false;
        main.then(() => { settled = true; }, () => { settled = true; });
        let stopRequested = false;
        let stopAttempts = 0;
        let lastGained = 0;
        let polls = 0;
        while (!settled) {
          await Promise.race([main.catch(() => {}), new Promise((r) => setTimeout(r, config.watchPollSec * 1000))]);
          if (settled) break;
          const current = await countInBag(displayName);
          polls += 1;
          if (current === null) continue;
          lastGained = Math.max(0, current - baseline);
          job.progress = { gained: lastGained, stopAtCount: stopAt };
          if (lastGained >= stopAt && !stopRequested && stopAttempts < 3) {
            stopAttempts += 1;
            const s = await cli.call('stop_action');
            stopRequested = isSuccess(s);
          }
        }
        return { stopAtCount: stopAt, stopRequested, lastObservedGained: lastGained, polls };
      })();
  }

  // ------------------------------------------------------------ handlers
  const handlers = {
    async status(args) {
      const res = await cli.call('status', undefined, { timeoutSec: 10 });
      const pipe = isPlainObject(res.body) ? res.body.pipe : undefined;
      const connected = res.transportOk && pipe === 'connected';
      const base = { server: `${SERVER_NAME}-mcp ${SERVER_VERSION}`, catalogDate: CATALOG_DATE, cli: cli.describe(), wings: wings.summary(), activeJob: jobs.view(jobs.active) };
      if (!connected) {
        const code = res.transportOk ? 'not_connected' : res.errorCode;
        return { ok: false, connected: false, error: code, detail: res.body, hint: hintFor(code) ?? hintFor('not_connected'), ...base };
      }
      const c = await loadCapabilities(args.refreshCapabilities === true);
      const out = { ok: true, connected: true, ...base };
      if (c.failure) out.capabilities = { error: c.failure };
      else {
        out.capabilities = { count: c.commands?.length ?? 0, loading: c.loading, ...capabilityDrift() };
        if (c.loading) out.hint = hintFor('capabilities_loading');
        else if (out.capabilities.newCommands?.length) out.note = '게임에 새 명령이 추가되었습니다. query(capabilities, compact:false) 로 내용을 확인하고 사용자에게 알리세요. 전용 도구가 없으면 raw_call 을 쓸 수 있습니다.';
      }
      return out;
    },

    async query(args) {
      const command = String(args.command || '');
      if (!QUERY_COMMANDS.includes(command)) return fail('invalid_command', `조회 명령이 아닙니다: ${command}`, { allowed: QUERY_COMMANDS });
      const filter = typeof args.filter === 'string' && args.filter.trim() !== '' ? args.filter.trim() : null;
      const compact = args.compact !== false;

      if (command === 'capabilities') {
        const c = await loadCapabilities(true);
        if (c.failure) return c.failure;
        let list = c.commands || [];
        if (filter) list = list.filter((row) => shape.matchesText(row, filter));
        if (!compact) return { ok: true, command, loading: c.loading, commands: list };
        return {
          ok: true, command, loading: c.loading, count: list.length, ...capabilityDrift(),
          commands: list.map((row) => shape.prune({ Command: row.Command, Description: row.Description, requiresConfirm: row.Metadata?.requiresConfirm })),
          tip: '명령별 BodyExample/OutputExample/Note 전문은 compact:false + filter 로 조회.',
        };
      }

      let body;
      if (command === 'get_items') {
        const b = {};
        if (typeof args.category === 'string' && args.category.trim()) b.category = args.category.trim();
        if (filter) b.name = filter;
        body = Object.keys(b).length ? b : undefined;
      } else if (filter && RAW_FILTER_COMMANDS.has(command)) {
        body = filter;
      }

      const res = await cli.call(command, body);
      if (!isSuccess(res)) return fromCliFailure(res, { command });
      const out = { ok: true, command };
      if (res.encodingFallback) out.encodingFallback = res.encodingFallback;
      if (!compact) {
        // 원본 그대로이되 목록은 limit 까지만(제작 목록은 1,800행·20만 자가 넘는다 — 2026-09-19 실측).
        const ex = shape.extractRows(res.body);
        const rawLimit = clamp(args.limit ?? config.defaultListLimit, 1, 500);
        if (ex?.key && Array.isArray(ex.rows) && ex.rows.length > rawLimit) {
          const rows = filter ? ex.rows.filter((row) => shape.matchesText(row, filter)) : ex.rows;
          return { ...out, total: rows.length, returned: Math.min(rows.length, rawLimit), truncated: rows.length > rawLimit, data: { ...ex.meta, [ex.key]: rows.slice(0, rawLimit) } };
        }
        return { ...out, data: res.body };
      }

      const data = res.body;
      if (command === 'get_my_info') return { ...out, data: shape.prune(shape.flattenStats(data)) };
      if (command === 'get_activity') {
        const pruned = shape.pruneIdle(data);
        return { ...out, data: isPlainObject(pruned) && Object.keys(pruned).length === 0 ? { idle: true } : pruned };
      }
      if (command === 'get_social_actions' && isPlainObject(data)) {
        const limit = clamp(args.limit ?? config.defaultListLimit, 1, 500);
        const cut = (arr) => (Array.isArray(arr) ? arr.slice(0, limit).map(shape.prune) : arr);
        return { ...out, totals: { Behaviours: data.Behaviours?.length ?? 0, Facials: data.Facials?.length ?? 0 }, Behaviours: cut(data.Behaviours), Facials: cut(data.Facials) };
      }

      const extracted = shape.extractRows(data);
      if (!extracted) return { ...out, data: shape.prune(data) };
      let rows = extracted.rows;
      const serverFiltered = body !== undefined;
      if (filter && !serverFiltered) rows = rows.filter((row) => shape.matchesText(row, filter));
      if (args.onlyActionable === true) rows = rows.filter((row) => shape.isActionable(command, row));
      if (command === 'get_near_npcs' || command === 'get_near_pcs') rows = shape.sortByDistance(rows);
      const total = rows.length;

      if (command === 'get_currencies') {
        return { ...out, ...shape.prune(extracted.meta), total, currencies: shape.currenciesToMap(rows, { keepZero: Boolean(filter) }) };
      }
      const limit = clamp(args.limit ?? config.defaultListLimit, 1, 500);
      const limited = rows.slice(0, limit).map((row) => shape.compactRow(command, row));
      return { ...out, ...shape.prune(extracted.meta), total, returned: limited.length, truncated: total > limited.length, rows: limited };
    },

    async snapshot(args) {
      const sections = Array.isArray(args.sections) && args.sections.length ? args.sections.filter((s) => SNAPSHOT_SECTIONS.includes(s)) : DEFAULT_SNAPSHOT;
      const out = { ok: true };
      const errors = {};
      const run = async (section, command, shaper) => {
        const res = await cli.call(command);
        if (!isSuccess(res)) { errors[section] = fromCliFailure(res); return false; }
        out[section] = shaper(res.body);
        return true;
      };
      const missions = (body) => {
        const rows = shape.extractRows(body)?.rows ?? [];
        const pending = rows.filter((row) => shape.isActionable('get_daily_missions', row));
        return { total: rows.length, pending: pending.length, rows: pending.map((row) => shape.compactRow('get_daily_missions', row)) };
      };

      let myInfoCache = null;
      const myInfo = async () => {
        if (myInfoCache) return myInfoCache;
        const res = await cli.call('get_my_info');
        myInfoCache = res;
        return res;
      };

      for (const section of sections) {
        if (section === 'environment') {
          const okEnv = await run(section, 'get_current_environment', (b) => shape.prune(b));
          if (!okEnv && errors[section] && errors[section].status === 'transport_error') break; // 연결 자체가 안 되면 나머지도 의미 없음
        } else if (section === 'me' || section === 'stats') {
          const res = await myInfo();
          if (!isSuccess(res)) { errors[section] = fromCliFailure(res); continue; }
          const flat = shape.prune(shape.flattenStats(res.body));
          if (section === 'stats') out.stats = flat;
          else {
            const brief = {};
            for (const k of ['Title', 'RealmName', 'Level', 'EnabledCombatJobDisplayName', 'CombatScore', 'LivingScore', 'AttractivenessScore', 'DecorScore', 'Vitals']) {
              if (isPlainObject(res.body) && res.body[k] !== undefined) {
                const v = res.body[k];
                if (isPlainObject(v) && 'Value' in v && 'DisplayName' in v) brief[String(v.DisplayName || k)] = v.Value;
                else brief[k] = isPlainObject(v) ? shape.prune(shape.flattenStats(v)) : v;
              }
            }
            out.me = Object.keys(brief).length ? brief : flat;
          }
        } else if (section === 'currencies') {
          await run(section, 'get_currencies', (b) => shape.currenciesToMap(shape.extractRows(b)?.rows ?? []));
        } else if (section === 'activity') {
          await run(section, 'get_activity', (b) => {
            const p = shape.pruneIdle(b);
            return isPlainObject(p) && Object.keys(p).length === 0 ? { idle: true } : p;
          });
        } else if (section === 'altering') {
          await run(section, 'get_altering_works', (b) => {
            const ex = shape.extractRows(b);
            if (!ex) return shape.prune(b);
            return { ...shape.prune(ex.meta), works: ex.rows.map((w) => shape.prune(isPlainObject(w) ? { DisplayName: w.DisplayName, FacilityName: w.FacilityName, State: w.State, RemainingSeconds: w.RemainingSeconds } : w)) };
          });
        } else if (section === 'daily') {
          await run(section, 'get_daily_missions', missions);
        } else if (section === 'weekly') {
          await run(section, 'get_weekly_missions', missions);
        } else if (section === 'quests') {
          await run(section, 'get_quests', (b) => (shape.extractRows(b)?.rows ?? []).map((row) => shape.compactRow('get_quests', row)));
        } else if (section === 'gear') {
          // 도구·악기 내구도 점검. 커넥터는 "쓸 수 있는 도구가 있는지(ToolOk)"와 악기 내구도만 알려 준다(무기·방어구 내구도는 조회 불가).
          const gear = {};
          const gatherables = await cli.call('get_gatherable_items');
          if (isSuccess(gatherables)) {
            const rows = (shape.extractRows(gatherables.body)?.rows ?? []).filter(isPlainObject);
            const blocked = rows.filter((r) => r.ToolOk === false).map((r) => r.DisplayName);
            gear.gatherables = { total: rows.length, toolOk: rows.length - blocked.length, noUsableTool: blocked.slice(0, 40), ...(blocked.length > 40 ? { truncated: true } : {}) };
          } else errors.gear = fromCliFailure(gatherables);
          const instruments = await cli.call('get_instruments');
          if (isSuccess(instruments)) {
            const rows = (shape.extractRows(instruments.body)?.rows ?? []).filter(isPlainObject);
            gear.instruments = rows.map((r) => shape.prune({ Name: r.Name, Durability: r.Durability, IsEquipped: r.IsEquipped || undefined, low: typeof r.Durability === 'number' && r.Durability <= LOW_DURABILITY ? true : undefined }));
          }
          if (Object.keys(gear).length > 0) out.gear = gear;
        }
      }
      out.wings = wings.summary();
      if (Object.keys(errors).length) {
        out.errors = errors;
        if (Object.keys(errors).length === sections.length || sections.every((s) => out[s] === undefined)) out.ok = false;
      }
      return out;
    },

    async gather(args, reqCtx) {
      const displayName = String(args.displayName || '').trim();
      if (!displayName) return fail('invalid_body', 'displayName 이 필요합니다.');
      if (jobs.isBusy()) return busyFailure();
      const found = await resolveExact('get_gatherable_items', displayName);
      if (found.failure) return found.failure;
      if (found.row.ToolOk === false) return fail('tool_missing', `"${displayName}" 채집에 필요한 도구가 없거나 내구도가 0입니다. (정령의 날개는 쓰지 않았습니다)`);

      let watcherFactory = null;
      const extra = {};
      const stopAt = Number.isInteger(args.stopAtCount) ? args.stopAtCount : null;
      if (stopAt !== null && stopAt >= 1 && stopAt < 100) {
        const baseline = await countInBag(displayName);
        if (baseline === null) extra.stopAtCountNote = '가방 수량을 조회하지 못해 stopAtCount 를 적용하지 않았습니다(최대 100개까지 채집될 수 있음).';
        else watcherFactory = makeGatherWatcher(displayName, stopAt, baseline);
      }
      const baseline = await listGatherableNames();
      const finalize = async (result) => {
        if (!baseline || !(result.gained > 0)) return {};
        const now = await listGatherableNames();
        if (!now) return {};
        const newGatherables = [...now].filter((n) => !baseline.has(n));
        return newGatherables.length ? { newGatherables, next: '새 채집물이 열렸습니다 → 생활 스킬 레벨이 오른 것으로 보입니다. 다음 목표 후보입니다.' } : {};
      };
      return runCostly(reqCtx, { kind: 'gather', label: `채집: ${displayName}`, command: 'execute_gathering', body: { displayName }, waitSec: args.waitSec, watcherFactory, extra, retryAfterFix: args.retryAfterFix, checkBag: true, finalize });
    },

    async craft(args, reqCtx) {
      const displayName = String(args.displayName || '').trim();
      if (!displayName) return fail('invalid_body', 'displayName 이 필요합니다.');
      const craftCount = args.craftCount === undefined ? 1 : args.craftCount;
      if (!Number.isInteger(craftCount) || craftCount < 1) return fail('invalid_count', 'craftCount 는 1 이상의 정수(제작 횟수)여야 합니다.');
      if (jobs.isBusy()) return busyFailure();
      const found = await resolveExact('get_craftable_items', displayName);
      if (found.failure) {
        if (found.meta?.craftingUnlocked === false) return fail('crafting_locked', '제작 시스템이 아직 해금되지 않았습니다.');
        return found.failure;
      }
      if (found.row.Craftable === false) {
        const reason = found.row.Reason;
        return fail(reason || 'not_available', `"${displayName}" 은(는) 지금 제작할 수 없습니다. (정령의 날개는 쓰지 않았습니다)`, shape.prune({ Reason: reason, MissingIngredients: found.row.MissingIngredients, ProducedPerCraft: found.row.ProducedPerCraft }));
      }
      return runCostly(reqCtx, {
        kind: 'craft', label: `제작: ${displayName} ×${craftCount}회`, command: 'execute_crafting', body: { displayName, craftCount }, waitSec: args.waitSec, retryAfterFix: args.retryAfterFix, checkBag: true,
        extra: shape.prune({ ProducedPerCraft: found.row.ProducedPerCraft }),
      });
    },

    async alter(args, reqCtx) {
      const displayName = String(args.displayName || '').trim();
      if (!displayName) return fail('invalid_body', 'displayName 이 필요합니다.');
      if (jobs.isBusy()) return busyFailure();
      const found = await resolveExact('get_alterable_items', displayName);
      if (found.failure) return found.failure;
      if (found.row.Alterable === false) {
        const reason = found.row.Reason;
        return fail(reason || 'not_available', `"${displayName}" 은(는) 지금 가공할 수 없습니다. (정령의 날개는 쓰지 않았습니다)`, shape.prune({ Reason: reason, MissingIngredients: found.row.MissingIngredients, ProducedPerWork: found.row.ProducedPerWork }));
      }
      return runCostly(reqCtx, {
        kind: 'alter', label: `가공 등록: ${displayName}`, command: 'execute_altering', body: { displayName }, waitSec: args.waitSec, retryAfterFix: args.retryAfterFix,
        extra: shape.prune({ ProducedPerWork: found.row.ProducedPerWork, next: '가공은 비동기입니다. query(get_altering_works) 로 남은 시간을 확인하고, 완료되면 collect_altered 로 수령하세요.' }),
      });
    },

    async collect_altered(args, reqCtx) {
      if (jobs.isBusy()) return busyFailure();
      const worksRes = await cli.call('get_altering_works');
      if (!isSuccess(worksRes)) return fromCliFailure(worksRes, { during: 'get_altering_works' });
      const ex = shape.extractRows(worksRes.body);
      const works = (ex?.rows ?? []).filter(isPlainObject);
      const completed = works.filter((w) => w.IsCompleted === true || w.State === 'Completed');
      if (completed.length === 0) {
        const soonest = works.filter((w) => typeof w.RemainingSeconds === 'number').sort((a, b) => a.RemainingSeconds - b.RemainingSeconds)[0];
        return fail(works.length ? 'no_completed_work' : 'no_altering', works.length ? '아직 완료된 가공 작업이 없습니다.' : '진행 중인 가공 작업이 없습니다.', shape.prune({ soonest: soonest ? { DisplayName: soonest.DisplayName, RemainingSeconds: soonest.RemainingSeconds } : undefined }));
      }
      let displayName = typeof args.displayName === 'string' ? args.displayName.trim() : '';
      if (!displayName) displayName = completed[0].DisplayName;
      else if (!works.some((w) => w.DisplayName === displayName)) {
        return fail('not_found', `"${displayName}" 이름의 가공 작업이 없습니다.`, { candidates: [...new Set(works.map((w) => w.DisplayName))].slice(0, 10) });
      }
      let job;
      try {
        job = jobs.start('collect', `가공 수령: ${displayName}`, async () => {
          const { res, settled } = await runMeasured('complete_altering_work', { displayName }, { timeoutSec: config.actionTimeoutSec });
          invalidateLists();
          const after = await cli.call('get_altering_works');
          const remaining = isSuccess(after) ? (shape.extractRows(after.body)?.rows ?? []).filter((w) => isPlainObject(w) && (w.IsCompleted === true || w.State === 'Completed')).length : undefined;
          return actionResult(res, settled, shape.prune({ remainingCompleted: remaining, next: remaining ? '다른 시설에 완료된 작업이 남아 있습니다. 시설마다 한 번씩 collect_altered 를 호출하세요.' : undefined }));
        });
      } catch {
        return busyFailure();
      }
      return waitForJob(reqCtx, job, args.waitSec);
    },

    async play_music(args) {
      const title = String(args.title || '').trim();
      if (!title) return fail('invalid_body', 'title 이 필요합니다.');
      if (jobs.isBusy()) return busyFailure();
      const found = await resolveExact('get_music_scores', title, 'DisplayTitle');
      if (found.failure) return found.failure;
      if (typeof args.instrument === 'string' && args.instrument.trim()) {
        const changed = await handlers.change_instrument({ name: args.instrument.trim() });
        if (!changed.ok) return { ...changed, during: 'change_instrument' };
      }
      const { res, settled } = await runMeasured('play_music_score', { title }, { timeoutSec: 60 });
      return actionResult(res, settled, isSuccess(res) ? { next: '연주 상태는 query(get_activity) 의 Performance 로 확인, 멈출 때는 stop_action.' } : {});
    },

    async change_instrument(args) {
      const name = String(args.name || '').trim();
      if (!name) return fail('invalid_body', 'name 이 필요합니다.');
      const found = await resolveExact('get_instruments', name, 'Name');
      if (found.failure) return found.failure;
      if (found.row.IsEquipped === true) return { ok: true, status: 'accepted', message: '이미 장착 중인 악기입니다.', Name: name };
      const res = await cli.call('change_instrument', { name }, { timeoutSec: 60 });
      return actionResult(res, null, { Name: name });
    },

    async stop_action() {
      const res = await cli.call('stop_action', undefined, { timeoutSec: 60 });
      return actionResult(res, null);
    },

    async stand_up() {
      const res = await cli.call('stand_up', undefined, { timeoutSec: 60 });
      return actionResult(res, null);
    },

    async chat(args) {
      const message = typeof args.message === 'string' ? args.message : '';
      if (message.trim() === '') return fail('invalid_body', '보낼 문구가 비어 있습니다.');
      if (/[\r\n]/.test(message)) return fail('invalid_body', '채팅에는 줄바꿈을 넣을 수 없습니다.');
      if (/^base64:/i.test(message)) return fail('invalid_body', '"base64:" 로 시작하는 문구는 보낼 수 없습니다.');
      const length = [...message].length;
      if (length > config.chatMaxChars) return fail('message_too_long', `채팅은 최대 ${config.chatMaxChars}자입니다(현재 ${length}자).`, { length });
      if (args.approvedByUser !== true) return fail('approval_required', '사용자 승인이 필요합니다.', { pendingMessage: message });
      const throttle = chatGuard.precheck();
      if (!throttle.ok) return fail('chat_throttled', '채팅 간 최소 간격이 지나지 않았습니다.', { retryAfterSeconds: throttle.retryAfterSeconds });
      // 채팅은 "성공했지만 글자가 깨진" 경우를 되돌릴 수 없으므로, 한글 인코딩을 먼저 무해한 조회로 확정한다.
      if (/[^\x20-\x7E]/.test(message)) await cli.ensureEncodingConfirmed();
      const res = await cli.call('write_chat', message, { timeoutSec: 120 });
      if (isSuccess(res)) chatGuard.recordSent();
      else if (res.errorCode === 'rate_limited' && isPlainObject(res.body)) chatGuard.recordRateLimited(res.body.retryAfterSeconds);
      return actionResult(res, null, { sentMessage: isSuccess(res) ? message : undefined });
    },

    async job(args, reqCtx) {
      const action = String(args.action || 'status');
      if (action === 'list') return { ok: true, active: jobs.view(jobs.active), recent: jobs.history.map((j) => jobs.view(j)) };
      const job = jobs.find(args.jobId);
      if (!job) return fail('not_found', '해당 작업이 없습니다(서버가 재시작되면 작업 기록은 사라집니다).', { active: jobs.view(jobs.active) });
      if (action === 'wait') return waitForJob(reqCtx, job, args.waitSec);
      return job.state === 'done' ? { ...job.result, job: jobs.view(job) } : { ok: true, running: true, job: jobs.view(job), ...(job.progress ? { progress: job.progress } : {}) };
    },

    /** 재료 부족분을 따라 내려가 채집→가공→제작 순서의 계획을 만든다(무료). 게임은 부족한 재료만 알려 주므로 완전한 재료 트리는 아니다. */
    async plan_craft(args) {
      const target = String(args.displayName || '').trim();
      if (!target) return fail('invalid_body', 'displayName 이 필요합니다.');
      const count = args.count === undefined ? 1 : args.count;
      if (!Number.isInteger(count) || count < 1) return fail('invalid_count', 'count 는 1 이상의 정수(결과물 개수)여야 합니다.');

      const lists = {};
      for (const [key, command] of [['craft', 'get_craftable_items'], ['alter', 'get_alterable_items'], ['gather', 'get_gatherable_items']]) {
        const list = await fetchList(command);
        if (list.failure) return list.failure;
        lists[key] = list.rows;
      }
      const pickRow = (rows, name, okKey) => {
        const same = rows.filter((r) => r.DisplayName === name);
        if (!same.length) return null;
        return same.find((r) => r[okKey] === true) || same.find((r) => r.Reason === 'not_enough_ingredient') || same[0];
      };
      // 이미 대기열에 있는 가공(진행 중·완료 미수령)은 곧 생길 재료로 친다
      const queued = {};
      { const w = await cli.call('get_altering_works'); if (isSuccess(w)) for (const row of (shape.extractRows(w.body)?.rows ?? []).filter(isPlainObject)) { if (typeof row.DisplayName === 'string') queued[row.DisplayName] = (queued[row.DisplayName] || 0) + 1; } }
      const gatherRow = (name) => pickRow(lists.gather, name, 'ToolOk');
      const alterRow = (name) => pickRow(lists.alter, name, 'Alterable');
      const craftRow = (name) => pickRow(lists.craft, name, 'Craftable');

      const steps = []; const manual = []; const uncertain = [];
      const addStep = (kind, displayName, qty, units, unitKey, depth, note) => {
        const found = steps.find((s) => s.kind === kind && s.displayName === displayName);
        if (found) { found.qty += qty; found[unitKey] += units; found.depth = Math.max(found.depth, depth); return; }
        steps.push(shape.prune({ kind, displayName, qty, [unitKey]: units, depth, note }));
      };
      const MAX_DEPTH = 4;
      const resolve = (name, need, depth, chain) => {
        if (depth > MAX_DEPTH || chain.includes(name)) { manual.push({ displayName: name, qty: need, reason: 'too_deep' }); return; }
        const g = gatherRow(name);
        if (g) {
          if (g.ToolOk === false) manual.push({ displayName: name, qty: need, reason: 'tool_missing' });
          else addStep('gather', name, need, Math.ceil(need / 100), 'calls', depth);
          return;
        }
        const a = alterRow(name);
        if (a) {
          const per = toNumber(a.ProducedPerWork) || 1;
          const inQueue = queued[name] || 0;
          const stillNeed = Math.max(0, need - inQueue * per);
          if (inQueue) uncertain.push({ displayName: name, queued: inQueue, note: `대기열에 ${inQueue}건(약 ${inQueue * per}개)이 있어 그만큼 뺐다. 완료되면 collect_altered 로 수령.` });
          if (stillNeed === 0) return;
          const works = Math.ceil(stillNeed / per);
          if (a.Alterable === false && a.Reason !== 'not_enough_ingredient') { manual.push({ displayName: name, qty: need, reason: a.Reason || 'not_available' }); return; }
          addStep('alter', name, stillNeed, works, 'works', depth, '등록 1건 = 날개 5개 · 경험치 없음 → 게임에서 직접 거는 편이 이득');
          const miss = Array.isArray(a.MissingIngredients) ? a.MissingIngredients.filter(isPlainObject) : [];
          if (!miss.length && works > 1) uncertain.push({ displayName: name, works, note: '재료는 지금 1건 기준으로만 충분하다고 나온다. 여러 건이면 중간에 부족해질 수 있다.' });
          for (const m of miss) {
            const short = Math.max(0, (toNumber(m.Required) || 0) * works - (toNumber(m.Owned) || 0));
            if (short > 0) resolve(m.DisplayName, short, depth + 1, [...chain, name]);
          }
          return;
        }
        const c = craftRow(name);
        if (c) {
          const per = toNumber(c.ProducedPerCraft) || 1;
          const runs = Math.ceil(need / per);
          if (c.Craftable === false && c.Reason !== 'not_enough_ingredient') { manual.push({ displayName: name, qty: need, reason: c.Reason || 'not_available' }); return; }
          addStep('craft', name, need, runs, 'runs', depth, '한 호출에 craftCount 로 묶는다(상한 초과 시 invalid_count+maxCount 로 나눈다)');
          const miss = Array.isArray(c.MissingIngredients) ? c.MissingIngredients.filter(isPlainObject) : [];
          if (!miss.length && runs > 1) uncertain.push({ displayName: name, runs, note: '재료는 지금 1회 기준으로만 충분하다고 나온다. 여러 회면 중간에 부족해질 수 있다.' });
          for (const m of miss) {
            const short = Math.max(0, (toNumber(m.Required) || 0) * runs - (toNumber(m.Owned) || 0));
            if (short > 0) resolve(m.DisplayName, short, depth + 1, [...chain, name]);
          }
          return;
        }
        manual.push({ displayName: name, qty: need, reason: 'not_in_lists' });
      };

      if (!craftRow(target) && !alterRow(target)) {
        const cands = [...lists.craft, ...lists.alter].map((r) => r.DisplayName).filter((n) => typeof n === 'string' && n.includes(target)).slice(0, 10);
        return fail('not_found', `"${target}" 이름의 제작법·가공이 없습니다.`, { candidates: [...new Set(cands)] });
      }
      resolve(target, count, 0, []);

      const order = { gather: 0, alter: 1, craft: 2 };
      steps.sort((x, y) => (y.depth - x.depth) || (order[x.kind] - order[y.kind]));
      const per = config.wingsCostPerActivity;
      let estimated = 0;
      for (const s of steps) {
        s.wings = per * (s.calls ?? s.works ?? (s.kind === 'craft' ? 1 : s.runs));
        estimated += s.wings;
        delete s.depth;
      }
      const sum = wings.summary();
      const left = (str) => { const m = /^(\d+)\/(\d+)$/.exec(String(str || '')); return m ? Math.max(0, Number(m[2]) - Number(m[1])) : null; };
      const sessionLeft = left(sum.session); const dailyLeft = sum.today ? left(sum.today) : null;
      const alterShare = per * steps.filter((s) => s.kind === 'alter').reduce((n, s) => n + s.works, 0);
      const warnings = [];
      if (sessionLeft !== null && estimated > sessionLeft) warnings.push(`세션 한도까지 ${sessionLeft}개 남았는데 예상 ${estimated}개 → 이번 세션에는 일부만 실행된다. 가공 등록을 게임에서 직접 걸면 ${alterShare}개를 아낀다.`);
      if (dailyLeft !== null && estimated > dailyLeft) warnings.push(`오늘 한도까지 ${dailyLeft}개 남았다.`);
      const next = steps.length
        ? '표를 사용자에게 보여 주고 한 번 승인받은 뒤 steps 순서대로 실행: gather(각 1호출, job wait) → alter(건수만큼, 또는 사용자가 게임에서 직접) → 가공은 완료를 기다리지 않고 남은 시간을 알린다 → 완료 후 collect_altered → craft(craftCount).'
        : '지금 재료가 충분합니다. 바로 craft/alter 를 호출하세요.';
      const out = shape.prune({
        ok: true, target, count, manual: manual.length ? manual : undefined, uncertain: uncertain.length ? uncertain : undefined,
        wings: { estimated, sessionLeft, dailyLeft, balance: sum.balance, alterShare },
        warnings: warnings.length ? warnings : undefined, next,
      });
      out.steps = steps; // 빈 계획도 배열로(에이전트가 length 로 판단)
      return out;
    },

    async homework(args) {
      const action = String(args.action || 'list');
      let defs;
      try {
        defs = homeworkStore.loadDefs();
      } catch (err) {
        return hwFail('homework_defs_invalid', `숙제 목록 파일을 읽지 못했습니다: ${homeworkStore.defsPath} — ${err.message}`);
      }
      const state = homeworkStore.loadState();
      const c = homeworkStore.clock(defs);
      const items = homeworkStore.items(defs, state);
      const guideDefs = Array.isArray(defs.guides) ? defs.guides.filter(isPlainObject) : [];
      const matchesGuide = (g, query) => {
        const q = normalizeText(query);
        if (!q) return false;
        return [g.id, g.name, ...(g.aliases || [])].some((t) => {
          const n = normalizeText(t);
          return n !== '' && (n === q || n.includes(q) || q.includes(n));
        });
      };
      const guideOnly = (what) =>
        hwFail('guide_only', `"${what}" 은(는) 사람이 직접 하는 콘텐츠라 숙제 체크리스트에서 빠져 있습니다.`, {
          tip: 'homework(action:"guide", item:"…") 로 가이드(규칙·입장 조건·내 스펙 비교)를 보여 주세요. 체크리스트로 관리하고 싶다고 하면 homework(action:"enable", group:"preset:raid-abyss").',
        });
      const requested = typeof args.character === 'string' && args.character.trim() ? args.character.trim() : null;

      if (action === 'characters') {
        if (requested) {
          if (args.delete === true) {
            if (state.characters.length <= 1) return hwFail('invalid_state', '마지막 캐릭터 프로필은 지울 수 없습니다.');
            state.characters = state.characters.filter((n) => n !== requested);
            if (state.progress) delete state.progress[requested];
            if (state.active === requested) state.active = state.characters[0];
          } else {
            if (!state.characters.includes(requested)) state.characters.push(requested);
            state.active = requested;
          }
          homeworkStore.saveState(state);
        }
        return { ok: true, characters: state.characters, active: state.active, note: '게임은 캐릭터 이름을 알려 주지 않으므로, 자동 동기화는 "지금 접속 중인 캐릭터"의 진행도를 선택된 프로필에 기록합니다.' };
      }

      const character = requested || state.active;
      if (!state.characters.includes(character)) {
        return hwFail('not_found', `"${character}" 캐릭터 프로필이 없습니다.`, { characters: state.characters, tip: 'homework(action:"characters", character:"<이름>") 으로 추가하세요.' });
      }

      const board = (extra = {}) => ({
        ok: true,
        ...extra,
        ...renderBoard({ store: homeworkStore, defs, state, character, c, pendingOnly: args.pendingOnly !== false, cycle: ['daily', 'weekly'].includes(args.cycle) ? args.cycle : 'all', detail: args.detail === true }),
        ...(guideDefs.length ? (args.detail === true ? { selfPlay: { names: guideDefs.map((g) => g.name), tip: '직접 플레이 콘텐츠. 규칙·입장 조건은 homework(action:"guide").' } } : { selfPlay: `${guideDefs.map((g) => g.name.split(' (')[0]).join('·')}=직접 플레이(규칙은 guide)` }) : {}),
      });

      const syncFromGame = async () => {
        const st = await cli.call('status', undefined, { timeoutSec: 10 });
        const connected = st.transportOk && isPlainObject(st.body) && st.body.pipe === 'connected';
        if (!connected) return { synced: false, reason: st.transportOk ? 'not_connected' : st.errorCode };
        const cache = new Map();
        const fetch = async (command) => {
          if (!cache.has(command)) cache.set(command, await cli.call(command));
          return cache.get(command);
        };
        const updated = [];
        for (const item of items.filter((i) => i.enabled && isPlainObject(i.auto))) {
          const source = item.auto.source;
          if (source === 'daily_missions' || source === 'weekly_missions') {
            const res = await fetch(source === 'daily_missions' ? 'get_daily_missions' : 'get_weekly_missions');
            if (!isSuccess(res)) continue;
            const rows = (shape.extractRows(res.body)?.rows ?? []).filter(isPlainObject);
            if (!rows.length) continue;
            const completed = rows.filter((r) => r.IsCompleted === true).length;
            const claimed = rows.filter((r) => r.IsCompleted === true && r.IsRewardReceived === true).length;
            const unclaimed = completed - claimed;
            homeworkStore.setProgress(state, item, character, c, { count: claimed, goal: rows.length, detail: unclaimed > 0 ? `완료했지만 보상 미수령 ${unclaimed}건` : undefined });
            updated.push(item.id);
          } else if (source === 'quest' && item.auto.titleIncludes) {
            const res = await fetch('get_quests');
            if (!isSuccess(res)) continue;
            const rows = (shape.extractRows(res.body)?.rows ?? []).filter(isPlainObject);
            const quest = rows.find((r) => String(r.QuestTitle || '').includes(item.auto.titleIncludes));
            if (!quest || !Array.isArray(quest.Objectives) || quest.Objectives.length === 0) continue; // 트래커에 없으면 수동 기록 유지
            const doneCount = quest.Objectives.filter((o) => isPlainObject(o) && o.IsCompleted === true).length;
            homeworkStore.setProgress(state, item, character, c, { count: doneCount, goal: quest.Objectives.length });
            updated.push(item.id);
          }
        }
        const live = {};
        const works = await fetch('get_altering_works');
        if (isSuccess(works)) {
          const rows = (shape.extractRows(works.body)?.rows ?? []).filter(isPlainObject);
          const ready = rows.filter((w) => w.IsCompleted === true || w.State === 'Completed').length;
          if (rows.length) live.altering = { readyToCollect: ready, inProgress: rows.length - ready };
        }
        if (updated.length) homeworkStore.saveState(state);
        return { synced: true, updated, ...(Object.keys(live).length ? { live } : {}) };
      };

      if (action === 'list' || action === 'sync') {
        const sync = action === 'sync' || args.sync !== false ? await syncFromGame() : { synced: false, reason: 'skipped' };
        if (args.detail === true) return board({ sync });
        // 압축 모드: 동기화 결과도 한 단어로
        return board({ sync: sync.synced ? 'ok' : sync.reason, ...(sync.live ? { live: sync.live } : {}) });
      }

      if (action === 'guide') {
        // 사람이 직접 하는 콘텐츠(어비스·레이드 등): 체크리스트 대신 규칙·입장 조건·내 스펙 비교를 안내한다.
        if (!guideDefs.length) return hwFail('not_found', 'data/homework.json 에 guides 가 없습니다.');
        let selected = guideDefs;
        if (typeof args.item === 'string' && args.item.trim()) {
          selected = guideDefs.filter((g) => matchesGuide(g, args.item));
          if (!selected.length) return hwFail('not_found', `"${args.item}" 가이드가 없습니다.`, { guides: guideDefs.map((g) => g.name) });
        }
        const out = {
          ok: true,
                    principle: '직접 플레이 콘텐츠(체크 대상 아님). 규칙·스펙 비교·준비물만 안내하고 보스 패턴은 지어내지 않는다.',
          weeklyReset: `${c.nextWeekly.at} (${Math.floor(c.nextWeekly.inMinutes / 60)}시간 뒤)`,
        };
        const statValue = (v) => (isPlainObject(v) && 'Value' in v ? toNumber(v.Value) : toNumber(v));
        let me = null;
        const st = await cli.call('status', undefined, { timeoutSec: 10 });
        if (st.transportOk && isPlainObject(st.body) && st.body.pipe === 'connected') {
          const info = await cli.call('get_my_info');
          if (isSuccess(info) && isPlainObject(info.body)) {
            const b = info.body;
            const vitals = isPlainObject(b.Vitals) ? b.Vitals : {};
            me = shape.prune({
              level: statValue(b.Level),
              job: b.EnabledCombatJobDisplayName,
              combatScore: statValue(b.CombatScore),
              arcaneResistance: statValue(b.ArcaneResistance),
              satietyRatio: toNumber(vitals.SatietyRatio),
              bagWeight: vitals.InventoryWeightMax ? `${vitals.InventoryWeightCurrent}/${vitals.InventoryWeightMax}` : undefined,
            });
            out.me = me;
          }
        }
        if (!me) out.meNote = '게임에 연결되지 않아 내 스펙과 비교하지 못했습니다.';
        out.guides = selected.map((g) => {
          const copy = { ...g };
          delete copy.aliases;
          if (Array.isArray(g.requirements)) {
            copy.requirements = g.requirements.map((r) => {
              const row = { ...r };
              if (me && Number.isFinite(me.combatScore) && Number.isFinite(r.combatScore)) row.combatScoreGap = me.combatScore - r.combatScore;
              if (me && Number.isFinite(me.arcaneResistance) && Number.isFinite(r.arcaneResistance)) row.arcaneResistanceGap = me.arcaneResistance - r.arcaneResistance;
              if ('combatScoreGap' in row || 'arcaneResistanceGap' in row) row.meets = (row.combatScoreGap ?? 0) >= 0 && (row.arcaneResistanceGap ?? 0) >= 0;
              return row;
            });
          }
          return copy;
        });
        return out;
      }

      if (action === 'plan') {
        // 목표별 "어디를 어떻게 돌지" 설정(plan)과 게임의 실제 진행도를 합쳐서 보여 준다. 실행은 하지 않는다.
        let target;
        if (typeof args.item === 'string' && args.item.trim()) {
          const found = homeworkStore.resolve(items, args.item);
          if (!found.item) return hwFail('not_found', `"${args.item}" 에 해당하는 숙제를 특정하지 못했습니다.`, { candidates: (found.matches || []).slice(0, 12).map((i) => ({ id: i.id, name: i.name })) });
          target = found.item;
        } else {
          target = items.find((i) => isPlainObject(i.plan));
        }
        if (!target || !isPlainObject(target.plan)) return hwFail('not_found', '이 숙제에는 plan 설정이 없습니다. data/homework.json 의 해당 항목에 plan 을 추가하세요.', { withPlan: items.filter((i) => isPlainObject(i.plan)).map((i) => i.name) });
        const plan = target.plan;
        const out = { ok: true, item: target.name, character, weeklyReset: `${c.nextWeekly.at} (${Math.floor(c.nextWeekly.inMinutes / 60)}시간 뒤)` };

        let objectives = null;
        const st = await cli.call('status', undefined, { timeoutSec: 10 });
        const connected = st.transportOk && isPlainObject(st.body) && st.body.pipe === 'connected';
        if (connected) {
          const needle = target.auto?.titleIncludes || target.name;
          const questsRes = await cli.call('get_quests');
          if (isSuccess(questsRes)) {
            const quest = (shape.extractRows(questsRes.body)?.rows ?? []).filter(isPlainObject).find((r) => String(r.QuestTitle || '').includes(needle));
            if (quest && Array.isArray(quest.Objectives) && quest.Objectives.length) {
              objectives = quest.Objectives.filter(isPlainObject);
              out.source = 'game';
              out.questTitle = quest.QuestTitle;
              const doneCount = objectives.filter((o) => o.IsCompleted === true).length;
              homeworkStore.setProgress(state, target, character, c, { count: doneCount, goal: objectives.length });
              homeworkStore.saveState(state);
            }
          }
          const watch = Array.isArray(plan.watchCurrencies) ? plan.watchCurrencies : [];
          if (watch.length) {
            const curRes = await cli.call('get_currencies');
            if (isSuccess(curRes)) {
              const rows = (shape.extractRows(curRes.body)?.rows ?? []).filter(isPlainObject);
              out.currencies = shape.currenciesToMap(rows.filter((r) => watch.some((w) => String(r.DisplayName || '').includes(w))), { keepZero: true });
            }
          }
        }
        if (!objectives) {
          out.source = 'fallback';
          out.hint = connected
            ? '퀘스트 트래커에 이 의뢰가 보이지 않습니다. 이미 완료했거나, 현재 열려 있는 트래커 탭에 없을 수 있습니다(get_quests 는 지금 보이는 탭만 돌려줌). 아래 횟수(심층 3·던전 5·사냥터 5)는 2026-07 커뮤니티 자료 기준입니다.'
            : '게임에 연결되지 않아 실제 진행도를 읽지 못했습니다. 아래 횟수(심층 3·던전 5·사냥터 5)는 2026-07 커뮤니티 자료 기준입니다.';
          objectives = (Array.isArray(plan.fallbackObjectives) ? plan.fallbackObjectives : []).map((o) => ({ Description: o.label, Goal: o.goal, unverified: true }));
          const p = homeworkStore.progressOf(state, target, character, c);
          out.recorded = `${p.count}/${p.goal}`;
        }

        const entries = Array.isArray(plan.objectives) ? plan.objectives : [];
        // 재화 소모 계산: costPerRun(1회 입장 비용)을 알려 주면 남은 횟수 × 비용 × (더블 루팅이면 2배)를 보유량과 비교한다.
        const haveOf = (currencyName) => {
          if (!currencyName || !isPlainObject(out.currencies)) return null;
          const hit = Object.entries(out.currencies).find(([name]) => name.includes(currencyName));
          return hit ? toNumber(hit[1]) : null;
        };
        let myLevel = null;
        if (connected && entries.some((e) => Number.isFinite(e.minLevel))) {
          const info = await cli.call('get_my_info');
          if (isSuccess(info) && isPlainObject(info.body)) myLevel = toNumber(isPlainObject(info.body.Level) ? info.body.Level.Value : info.body.Level);
        }
        out.steps = objectives.map((o) => {
          const entry = entries.find((e) => String(o.Description || '').includes(String(e.match)));
          const hasCount = Number.isFinite(o.Count) && Number.isFinite(o.Goal);
          const done = o.IsCompleted === true || (hasCount && o.Count >= o.Goal);
          const leftRuns = done ? 0 : hasCount ? Math.max(0, o.Goal - o.Count) : o.Goal;
          let spend;
          let runs;
          if (entry && !done && Number.isFinite(entry.costPerRun) && Number.isFinite(leftRuns)) {
            // 더블 루팅 1판이 클리어 2회로 세어지면 필요한 판 수가 절반(올림)이 된다
            runs = entry.doubleLoot && entry.doubleLootCountsTwice ? Math.ceil(leftRuns / 2) : leftRuns;
            const need = runs * entry.costPerRun * (entry.doubleLoot ? 2 : 1);
            const have = haveOf(entry.entryCurrency);
            const short = have === null ? undefined : Math.max(0, need - have);
            // 공식 충전 규칙(은동전 30분/개·100개부터 회복 중단, 마족 공물 12시간/개·10개부터 중단)으로 부족분 회복 시간을 알려 준다
            const rc = isPlainObject(plan.recharge) ? plan.recharge[entry.entryCurrency] : null;
            let recoverIn; let capNote;
            if (rc && short > 0 && Number.isFinite(rc.minutes)) {
              recoverIn = humanMinutes(short * rc.minutes);
              if (Number.isFinite(rc.stopsAt) && need > rc.stopsAt) capNote = `자동 회복은 보유 ${rc.stopsAt}개 미만일 때만 → 나머지는 보상·상점으로`;
            }
            spend = shape.prune({ currency: entry.entryCurrency, runs, need, have, short, recoverIn, capNote });
          }
          return shape.prune({
            spend,
            levelTooLow: entry && Number.isFinite(entry.minLevel) && myLevel !== null && myLevel < entry.minLevel ? `필요 Lv.${entry.minLevel} / 현재 Lv.${myLevel} → 입장 가능한 곳으로 설정을 바꾸세요` : undefined,
            costUnknown: entry && !done && entry.entryCurrency && !Number.isFinite(entry.costPerRun) ? true : undefined,
            objective: o.Description,
            progress: hasCount ? `${o.Count}/${o.Goal}` : o.Goal ? `?/${o.Goal}` : undefined,
            left: done ? 0 : hasCount ? Math.max(0, o.Goal - o.Count) : o.Goal,
            done,
            unverified: o.unverified,
            where: entry?.where,
            difficulty: entry?.difficulty,
            doubleLoot: entry?.doubleLoot,
            entryCurrency: entry?.entryCurrency,
            tip: entry?.tip,
          });
        });
        out.allDone = out.steps.length > 0 && out.steps.every((s) => s.done);
        if (args.detail === true && Array.isArray(plan.notes)) out.notes = plan.notes;
        return out;
      }

      // ---- 대상 항목 고르기
      const pickTargets = () => {
        if (typeof args.group === 'string' && args.group.trim()) {
          const selected = homeworkStore.selectGroup(items, args.group.trim());
          if (!selected.length) return { failure: hwFail('not_found', `"${args.group}" 그룹이 없습니다.`, { groups: [...new Set(items.map((i) => i.group))], presets: [...new Set(items.map((i) => `preset:${i.preset ?? 'core'}`))] }) };
          return { targets: selected };
        }
        if (typeof args.item !== 'string' || !args.item.trim()) return { failure: hwFail('invalid_body', 'item 또는 group 이 필요합니다.') };
        const found = homeworkStore.resolve(items, args.item);
        const tracking = ['check', 'uncheck', 'set'].includes(action);
        if (found.item) {
          if (tracking && !found.item.enabled && found.item.preset === 'raid-abyss') return { failure: guideOnly(args.item) };
          return { targets: [found.item] };
        }
        if (tracking && guideDefs.some((g) => matchesGuide(g, args.item)) && !(found.matches || []).some((i) => i.enabled)) return { failure: guideOnly(args.item) };
        return {
          failure: hwFail('not_found', `"${args.item}" 에 해당하는 숙제를 하나로 특정하지 못했습니다.`, {
            candidates: (found.matches || []).slice(0, 12).map((i) => ({ id: i.id, name: i.name, enabled: i.enabled })),
            tip: found.matches?.length ? '후보의 id 로 다시 호출하세요.' : 'homework(action:"list", pendingOnly:false) 로 목록을 확인하거나 add 로 새 항목을 만드세요.',
          }),
        };
      };

      if (action === 'add') {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return hwFail('invalid_body', 'add 에는 name 이 필요합니다.');
        if (!['daily', 'weekly'].includes(args.cycle)) return hwFail('invalid_body', 'add 에는 cycle(daily|weekly) 이 필요합니다.');
        if (items.some((i) => normalizeText(i.name) === normalizeText(name))) return hwFail('invalid_state', `같은 이름의 숙제가 이미 있습니다: ${name}`);
        const item = {
          id: `custom_${Date.now().toString(36)}`,
          name,
          aliases: [],
          group: typeof args.group === 'string' && args.group.trim() ? args.group.trim() : '사용자 추가',
          cycle: args.cycle,
          scope: args.scope === 'account' ? 'account' : 'character',
          count: Number.isInteger(args.count) && args.count > 0 ? args.count : 1,
          assist: 'manual',
          preset: 'core',
          ...(typeof args.note === 'string' && args.note.trim() ? { note: args.note.trim() } : {}),
        };
        state.custom = [...(state.custom || []), item];
        homeworkStore.saveState(state);
        return { ok: true, added: item };
      }

      const picked = pickTargets();
      if (picked.failure) return picked.failure;
      const targets = picked.targets;

      if (action === 'remove') {
        const customIds = new Set((state.custom || []).map((i) => i.id));
        const removable = targets.filter((t) => customIds.has(t.id));
        if (!removable.length) return hwFail('invalid_state', '기본 항목은 지울 수 없습니다. disable 로 끄세요.', { targets: targets.map((t) => t.id) });
        state.custom = state.custom.filter((i) => !removable.some((r) => r.id === i.id));
        homeworkStore.saveState(state);
        return { ok: true, removed: removable.map((t) => t.name) };
      }

      if (action === 'enable' || action === 'disable') {
        state.overrides ??= {};
        for (const t of targets) state.overrides[t.id] = { ...(state.overrides[t.id] || {}), enabled: action === 'enable' };
        homeworkStore.saveState(state);
        return { ok: true, [action === 'enable' ? 'enabled' : 'disabled']: targets.map((t) => t.name) };
      }

      if (['check', 'uncheck', 'set'].includes(action)) {
        const active = targets.filter((t) => t.enabled);
        if (!active.length && targets.every((t) => t.preset === 'raid-abyss')) return guideOnly(args.group || args.item);
        if (!active.length) return hwFail('invalid_state', '선택한 숙제가 꺼져 있습니다. enable 로 먼저 켜세요.', { targets: targets.map((t) => t.name) });
        if (action === 'set' && !Number.isInteger(args.count)) return hwFail('invalid_body', 'set 에는 count 가 필요합니다.');
        const changed = [];
        for (const t of active) {
          const p = homeworkStore.progressOf(state, t, character, c);
          const step = Number.isInteger(args.count) && args.count > 0 ? args.count : 1;
          let next;
          if (action === 'set') next = args.count;
          else if (action === 'check') next = args.all === true ? p.goal : p.count + step;
          else next = args.all === true ? 0 : p.count - step;
          const entry = homeworkStore.setProgress(state, t, character, c, { count: next, goal: p.goal });
          changed.push({ name: t.name, progress: `${entry.count}/${p.goal}`, done: entry.count >= p.goal });
        }
        homeworkStore.saveState(state);
        const after = renderBoard({ store: homeworkStore, defs, state, character, c, pendingOnly: true });
        return { ok: true, character, changed, summary: after.summary };
      }

      return hwFail('invalid_body', `알 수 없는 action: ${action}`);
    },

    async raw_call(args, reqCtx) {
      const command = String(args.command || '').trim();
      if (ACTION_COMMANDS.includes(command)) return fail('use_dedicated_tool', `"${command}" 은(는) 전용 도구(gather/craft/alter/collect_altered/play_music/change_instrument/stop_action/stand_up/chat)를 사용하세요. 보호 장치를 우회할 수 없습니다.`);
      const c = await loadCapabilities(false);
      if (c.failure) return c.failure;
      const spec = (c.commands || []).find((row) => row.Command === command);
      if (!spec) return fail('unknown_command', `현재 capabilities 에 "${command}" 명령이 없습니다.`, { available: (c.commands || []).map((row) => row.Command) });
      if (QUERY_COMMANDS.includes(command)) {
        const res = await cli.call(command, args.body);
        return isSuccess(res) ? { ok: true, command, data: res.body } : fromCliFailure(res, { command });
      }
      const requiresConfirm = String(spec.Metadata?.requiresConfirm ?? '').toLowerCase() === 'true';
      if (requiresConfirm && args.approvedByUser !== true) return fail('approval_required', `"${command}" 은(는) 사용자 확인이 필요한 명령입니다(requiresConfirm).`, { spec });
      const specText = JSON.stringify(spec);
      const costly = specText.includes(config.wingsName) || /consumes\s+\d+/i.test(specText);
      if (costly) {
        return runCostly(reqCtx, { kind: 'raw', label: `신규 명령: ${command}`, command, body: args.body, extra: { note: '카탈로그에 비용 언급이 있어 정령의 날개 보호 장치를 적용했습니다.' } });
      }
      if (jobs.isBusy()) return busyFailure();
      const { res, settled } = await runMeasured(command, args.body, { timeoutSec: config.actionTimeoutSec });
      return actionResult(res, settled, { command });
    },
  };

  const exposed = TOOLS.filter((t) => config.profile === 'full' || CORE_TOOLS.has(t.name));
  return {
    list: exposed,
    has: (name) => exposed.some((t) => t.name === name) && Object.prototype.hasOwnProperty.call(handlers, name),
    async call(name, args, reqCtx) {
      const result = await handlers[name](isPlainObject(args) ? args : {}, reqCtx);
      return result;
    },
  };
}
