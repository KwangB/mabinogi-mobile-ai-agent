// 조회 결과를 토큰을 아끼는 형태로 다듬는다.
// 원칙: 필드 "이름"은 capabilities 문서와 동일하게 유지하고, 의미 없는 값만 걷어낸다.
// 베타 기능이라 응답 모양이 바뀔 수 있으므로, 예상과 다르면 손대지 않고 그대로 돌려준다.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** null / '' / 빈 배열 / 빈 객체 제거. false 와 0 은 의미가 있으므로 남긴다. */
export function prune(value) {
  if (Array.isArray(value)) return value.map(prune);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const p = prune(v);
    if (p === null || p === undefined || p === '') continue;
    if (Array.isArray(p) && p.length === 0) continue;
    if (isPlainObject(p) && Object.keys(p).length === 0) continue;
    out[k] = p;
  }
  return out;
}

const IDLE_VALUES = new Set(['None', 'none', 'NotInDungeon', 'Hide']);

/** 상태 묶음용: false / 0 / 'None' 류까지 걷어내 "지금 일어나고 있는 것"만 남긴다. */
export function pruneIdle(value) {
  if (Array.isArray(value)) return value.map(pruneIdle);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const p = pruneIdle(v);
    if (p === null || p === undefined || p === '' || p === false || p === 0) continue;
    if (typeof p === 'string' && IDLE_VALUES.has(p)) continue;
    if (Array.isArray(p) && p.length === 0) continue;
    if (isPlainObject(p) && Object.keys(p).length === 0) continue;
    out[k] = p;
  }
  return out;
}

/** { DisplayName, Value } 형태의 능력치 객체를 "표시 이름: 값" 으로 편다(표시 이름은 게임이 준 그대로). */
export function flattenStats(value) {
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isPlainObject(v) && 'Value' in v && 'DisplayName' in v && Object.keys(v).length <= 3) {
      out[String(v.DisplayName || k)] = v.Value;
    } else if (isPlainObject(v)) {
      out[k] = flattenStats(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 응답에서 행 목록을 꺼낸다: 배열 자체, 또는 { items | works: [...] } */
export function extractRows(body) {
  if (Array.isArray(body)) return { rows: body, meta: {}, key: null };
  if (isPlainObject(body)) {
    for (const key of ['items', 'works']) {
      if (Array.isArray(body[key])) {
        const { [key]: rows, ...meta } = body;
        return { rows, meta, key };
      }
    }
  }
  return null;
}

export function matchesText(row, needle) {
  const n = String(needle).toLowerCase();
  const walk = (v) => {
    if (typeof v === 'string') return v.toLowerCase().includes(n);
    if (Array.isArray(v)) return v.some(walk);
    if (isPlainObject(v)) return Object.values(v).some(walk);
    return false;
  };
  return walk(row);
}

/** "지금 손쓸 수 있는 것만" 필터. 명령마다 의미가 다르다. */
export function isActionable(command, row) {
  if (!isPlainObject(row)) return true;
  switch (command) {
    case 'get_craftable_items': return row.Craftable !== false;
    case 'get_alterable_items': return row.Alterable !== false;
    case 'get_gatherable_items': return row.ToolOk !== false;
    case 'get_daily_missions':
    case 'get_weekly_missions': return !(row.IsCompleted === true && row.IsRewardReceived === true);
    case 'get_altering_works': return row.IsCompleted === true || row.State === 'Completed';
    case 'get_quests': return !Array.isArray(row.Objectives) || row.Objectives.some((o) => o && o.IsCompleted !== true);
    case 'get_instruments': return typeof row.Durability !== 'number' || row.Durability > 0;
    default: return true;
  }
}

function compactMission(row) {
  if (!isPlainObject(row)) return row;
  const out = { Title: row.Title };
  if (row.CurrentCount !== undefined || row.GoalCount !== undefined) out.Progress = `${row.CurrentCount ?? '?'}/${row.GoalCount ?? '?'}`;
  out.IsCompleted = row.IsCompleted;
  out.IsRewardReceived = row.IsRewardReceived;
  return out;
}

function compactQuest(row) {
  if (!isPlainObject(row)) return row;
  const out = { QuestTitle: row.QuestTitle };
  if (row.SourceDisplayName) out.SourceDisplayName = row.SourceDisplayName; // 없으면 Source 를 번역하지 말고 생략(capabilities 지시)
  if (Array.isArray(row.Objectives)) {
    out.Objectives = row.Objectives.map((o) =>
      isPlainObject(o)
        ? prune({ Description: o.Description, Progress: o.Goal ? `${o.Count ?? 0}/${o.Goal}` : undefined, IsCompleted: o.IsCompleted })
        : o,
    );
  }
  return out;
}

function compactNearPc(row) {
  if (!isPlainObject(row)) return row;
  const { Performance, ClothesCount, CrowdAppearanceColorCount, IsRobeWeared, IsHoodOn, IsWeaponHidden, ...rest } = row;
  const out = pruneIdle(rest);
  if (isPlainObject(Performance) && Performance.IsPlaying) out.Performance = pruneIdle(Performance);
  return out;
}

export function compactRow(command, row) {
  switch (command) {
    case 'get_daily_missions':
    case 'get_weekly_missions': return compactMission(row);
    case 'get_quests': return compactQuest(row);
    case 'get_near_pcs': return compactNearPc(row);
    default: return prune(row);
  }
}

/** 재화 목록 → { 표시이름: 수량 } (0 은 생략) */
export function currenciesToMap(rows, { keepZero = false } = {}) {
  const out = {};
  for (const r of rows) {
    if (!isPlainObject(r) || r.DisplayName === undefined) continue;
    if (!keepZero && (r.Amount === 0 || r.Amount === '0')) continue;
    out[String(r.DisplayName)] = r.Amount;
  }
  return out;
}

export function sortByDistance(rows) {
  if (!rows.every((r) => isPlainObject(r) && typeof r.Distance === 'number')) return rows;
  return [...rows].sort((a, b) => a.Distance - b.Distance);
}
