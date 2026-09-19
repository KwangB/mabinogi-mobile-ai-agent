// 숙제(일일/주간 반복 콘텐츠) 트래커.
// 원칙: 항목의 count = "전리품(보상)을 받을 수 있는 횟수". 다 받았으면 재입장이 가능해도 완료이며, 할 일 목록에서 빠진다.
// 초기화(매일 06:00 / 매주 월요일 06:00 KST) 계산은 LLM 이 아니라 이 코드가 한다.
import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const ACCOUNT_KEY = '_account';
export const DEFAULT_CHARACTER = '기본';

const pad = (n) => String(n).padStart(2, '0');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 비교용 정규화: 소문자, 공백·기호 제거 */
export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[\s()[\]{}·・\-–—_:,.'"/+]/g, '');
}

// ---------------------------------------------------------------- 시간 계산 (KST 고정 오프셋, DST 없음)

export function clock(nowMs, reset) {
  const offset = (reset.utcOffsetHours ?? 9) * HOUR;
  const resetHour = reset.hour ?? 6;
  const weeklyDay = reset.weeklyDay ?? 1; // 1 = 월요일
  const local = new Date(nowMs + offset); // UTC getter 로 읽으면 KST 벽시계
  const game = new Date(nowMs + offset - resetHour * HOUR); // "게임 날짜": 06시 이전은 전날로 친다
  const dayStartLocal = Date.UTC(game.getUTCFullYear(), game.getUTCMonth(), game.getUTCDate()) + resetHour * HOUR;
  const backToWeekStart = (game.getUTCDay() - weeklyDay + 7) % 7;
  const weekStartLocal = dayStartLocal - backToWeekStart * DAY;
  const ymd = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const stamp = (ms) => { const d = new Date(ms); return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}(${WEEKDAYS[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  return {
    offset,
    local,
    dailyKey: ymd(dayStartLocal),
    weeklyKey: ymd(weekStartLocal),
    nowText: `${local.getUTCFullYear()}-${stamp(local.getTime())} KST`,
    nextDaily: { at: stamp(dayStartLocal + DAY), inMinutes: Math.ceil((dayStartLocal + DAY - local.getTime()) / 60000) },
    nextWeekly: { at: stamp(weekStartLocal + 7 * DAY), inMinutes: Math.ceil((weekStartLocal + 7 * DAY - local.getTime()) / 60000) },
    stamp,
  };
}

export function humanMinutes(min) {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return `${d}일 ${h % 24}시간`;
}

/** 출현 일정 힌트: hourly(매시 정각) | times(["12:00", ...]) */
export function nextOccurrence(schedule, c) {
  if (!isPlainObject(schedule)) return null;
  const nowLocal = c.local.getTime();
  const dayBase = Date.UTC(c.local.getUTCFullYear(), c.local.getUTCMonth(), c.local.getUTCDate());
  let next = null;
  if (schedule.type === 'hourly') {
    next = dayBase + (c.local.getUTCHours() + 1) * HOUR;
  } else if (schedule.type === 'times' && Array.isArray(schedule.times)) {
    const candidates = [];
    for (const t of schedule.times) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t));
      if (!m) continue;
      const ms = dayBase + Number(m[1]) * HOUR + Number(m[2]) * 60000;
      candidates.push(ms > nowLocal ? ms : ms + DAY);
    }
    if (candidates.length) next = Math.min(...candidates);
  }
  if (next === null) return null;
  const inMinutes = Math.ceil((next - nowLocal) / 60000);
  return { at: c.stamp(next).split(' ')[1], in: humanMinutes(inMinutes), ...(schedule.verify ? { verify: true } : {}) };
}

// ---------------------------------------------------------------- 저장소

export class HomeworkStore {
  constructor({ dataDir, fallbackDefsPath = null, now = () => Date.now() }) {
    this.dataDir = dataDir;
    this.now = now;
    this.defsPath = path.join(dataDir, 'homework.json');
    this.fallbackDefsPath = fallbackDefsPath;
    this.statePath = path.join(dataDir, 'homework-state.json');
  }

  loadDefs() {
    // 상태만 다른 폴더에 두는 경우(모의 테스트 등)에는 기본 목록 파일을 그대로 쓴다
    if (!fs.existsSync(this.defsPath) && this.fallbackDefsPath && fs.existsSync(this.fallbackDefsPath)) this.defsPath = this.fallbackDefsPath;
    const raw = JSON.parse(fs.readFileSync(this.defsPath, 'utf8'));
    if (!Array.isArray(raw.items)) throw new Error('homework.json 에 items 배열이 없습니다.');
    return raw;
  }

  loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return { characters: [DEFAULT_CHARACTER], active: DEFAULT_CHARACTER, progress: {}, overrides: {}, custom: [], ...s };
    } catch {
      return { characters: [DEFAULT_CHARACTER], active: DEFAULT_CHARACTER, progress: {}, overrides: {}, custom: [] };
    }
  }

  saveState(state) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, this.statePath);
  }

  /** 기본 목록 + 사용자 추가 항목, enabled 계산까지 끝낸 목록 */
  items(defs, state) {
    const all = [...defs.items, ...(state.custom || [])];
    return all.map((item) => {
      const override = state.overrides?.[item.id];
      const enabled = typeof override?.enabled === 'boolean' ? override.enabled : (item.preset ?? 'core') === 'core';
      const count = Number.isInteger(override?.count) ? override.count : item.count ?? 1;
      return { ...item, count, enabled };
    });
  }

  clock(defs) {
    return clock(this.now(), defs.reset || {});
  }

  bucket(item, character) {
    return item.scope === 'account' ? ACCOUNT_KEY : character;
  }

  /** 현재 주기의 진행 상태(주기가 지났으면 자동으로 0) */
  progressOf(state, item, character, c) {
    const entry = state.progress?.[this.bucket(item, character)]?.[item.id];
    const periodKey = item.cycle === 'weekly' ? c.weeklyKey : c.dailyKey;
    if (!entry || entry.period !== periodKey) return { count: 0, goal: item.count, period: periodKey };
    return { count: entry.count ?? 0, goal: Number.isInteger(entry.goal) ? entry.goal : item.count, period: periodKey, detail: entry.detail, updatedAt: entry.updatedAt };
  }

  setProgress(state, item, character, c, { count, goal, detail }) {
    const bucket = this.bucket(item, character);
    state.progress ??= {};
    state.progress[bucket] ??= {};
    const periodKey = item.cycle === 'weekly' ? c.weeklyKey : c.dailyKey;
    const g = Number.isInteger(goal) ? goal : item.count;
    const entry = { count: Math.max(0, Math.min(count, g)), period: periodKey, updatedAt: new Date(this.now()).toISOString() };
    if (Number.isInteger(goal) && goal !== item.count) entry.goal = goal;
    if (detail) entry.detail = detail;
    state.progress[bucket][item.id] = entry;
    return entry;
  }

  /** id → 이름 → 별칭 → 부분일치 순으로 항목을 찾는다. 여러 개면 후보를 돌려준다. */
  resolve(items, query) {
    const q = normalize(query);
    if (!q) return { matches: [] };
    const byId = items.filter((i) => normalize(i.id) === q);
    if (byId.length === 1) return { item: byId[0] };
    const exact = items.filter((i) => normalize(i.name) === q || (i.aliases || []).some((a) => normalize(a) === q));
    if (exact.length === 1) return { item: exact[0] };
    const partial = items.filter((i) => normalize(i.name).includes(q) || (i.aliases || []).some((a) => normalize(a).includes(q)));
    const pool = exact.length ? exact : partial;
    const enabledOnly = pool.filter((i) => i.enabled);
    if (enabledOnly.length === 1) return { item: enabledOnly[0] };
    if (pool.length === 1) return { item: pool[0] };
    return { matches: pool };
  }

  /** "preset:shop" 또는 그룹 이름(예: "필드 보스")으로 여러 항목 선택 */
  selectGroup(items, group) {
    const g = String(group || '');
    if (g.startsWith('preset:')) {
      const preset = g.slice('preset:'.length).trim();
      return items.filter((i) => (i.preset ?? 'core') === preset);
    }
    const q = normalize(g);
    return items.filter((i) => normalize(i.group) === q);
  }
}

// ---------------------------------------------------------------- 보드 출력

export function renderBoard({ store, defs, state, character, c, pendingOnly = true, cycle = 'all', detail = false }) {
  const items = store.items(defs, state).filter((i) => i.enabled && (cycle === 'all' || i.cycle === cycle));
  const summary = { daily: { done: 0, total: 0 }, weekly: { done: 0, total: 0 } };
  const groups = new Map();
  const schedules = new Map();
  let hiddenDone = 0;

  for (const item of items) {
    const p = store.progressOf(state, item, character, c);
    const done = p.count >= p.goal;
    summary[item.cycle].total += 1;
    if (done) summary[item.cycle].done += 1;
    if (done && pendingOnly) { hiddenDone += 1; continue; }
    const row = { id: item.id, name: item.name, left: Math.max(0, p.goal - p.count), progress: `${p.count}/${p.goal}`, assist: item.assist };
    if (done) row.done = true;
    if (p.detail) row.detail = p.detail;
    if (item.verify) row.verify = true;
    if (item.assist === 'materials' && Array.isArray(item.materials)) row.materials = item.materials;
    if (detail && item.note) row.note = item.note;
    if (!done && item.schedule) {
      const key = JSON.stringify(item.schedule);
      if (!schedules.has(key)) schedules.set(key, { next: nextOccurrence(item.schedule, c), for: [] });
      schedules.get(key).for.push(item.name);
    }
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(row);
  }

  const upcomingList = [...schedules.values()].filter((s) => s.next);

  if (!detail) {
    // 기본(압축) 보드: 자주 호출되므로 토큰을 아낀다. 그룹마다 한 줄 문자열.
    // 표기: "이름 3/7"(횟수형) · "이름"(1회형, 아직 안 함) · "⚠"=횟수 미확인 · "[재료×n]"=AI 가 채집을 도울 수 있는 재료 · "✅"=완료(pendingOnly:false 일 때만)
    const line = (row) => {
      const [count, goal] = row.progress.split('/').map(Number);
      let text = row.done ? `✅${row.name}` : goal > 1 || count > 0 ? `${row.name} ${row.progress}` : row.name;
      if (row.detail) text += `(${row.detail})`;
      if (row.materials) text += `[${row.materials.map((m) => `${m.gather}×${m.count}`).join(',')}]`;
      if (row.verify) text += '⚠';
      return text;
    };
    const compactGroups = {};
    for (const [group, rows] of groups.entries()) compactGroups[group] = rows.map(line).join(' · ');
    return {
      now: c.nowText,
      ...(character !== DEFAULT_CHARACTER ? { character } : {}),
      reset: `일일 ${humanMinutes(c.nextDaily.inMinutes)} 뒤 · 주간 ${humanMinutes(c.nextWeekly.inMinutes)} 뒤(${c.nextWeekly.at})`,
      done: `일일 ${summary.daily.done}/${summary.daily.total} · 주간 ${summary.weekly.done}/${summary.weekly.total}`,
      left: compactGroups,
      ...(upcomingList.length ? { upcoming: upcomingList.map((s) => `${s.for.length > 1 ? s.for[0].split(' — ')[0] : s.for[0]} ${s.next.at}(${s.next.in} 뒤)${s.next.verify ? '⚠' : ''}`).join(' · ') } : {}),
    };
  }

  return {
    now: c.nowText,
    character,
    reset: {
      daily: `${c.nextDaily.at} (${humanMinutes(c.nextDaily.inMinutes)} 뒤)`,
      weekly: `${c.nextWeekly.at} (${humanMinutes(c.nextWeekly.inMinutes)} 뒤)`,
    },
    summary: {
      daily: `${summary.daily.done}/${summary.daily.total}`,
      weekly: `${summary.weekly.done}/${summary.weekly.total}`,
      ...(pendingOnly ? { hiddenDone } : {}),
    },
    groups: [...groups.entries()].map(([group, rows]) => ({ group, items: rows })),
    ...(schedules.size ? { upcoming: [...schedules.values()].filter((s) => s.next).map((s) => ({ ...s.next, for: s.for })) } : {}),
  };
}
