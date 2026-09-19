#!/usr/bin/env node
// 모의 MabinogiMobile_CLI — 게임 없이(예: macOS) MCP 서버를 시험하기 위한 가짜 CLI.
// 실제 CLI 와 같은 호출 규약을 흉내 낸다:  <command> [body]  → JSON 1개를 stdout 에 출력하고 종료.
// 응답 모양은 capabilities(2026-09-17) 의 OutputExample 을 따랐지만, 실제 게임과 다를 수 있다.
//
// 환경변수
//   MOCK_STATE_FILE      상태 저장 파일(호출 간 잔액/가방 유지)
//   MOCK_ENVELOPE        nested(기본: {status, body}) | flat({status, ...body}) | bare(조회는 본문만)
//   MOCK_MANGLE_RAW=1    원문 한글 인자가 깨져서 도착하는 환경을 흉내(→ base64 자동 전환 시험)
//   MOCK_NO_BASE64=1     base64: 접두를 이해하지 못하는 CLI 를 흉내
//   MOCK_DISCONNECTED=1  게임 미실행
//   MOCK_NEW_COMMAND=1   패치로 새 명령이 생긴 상황(get_pets)
//   MOCK_GATHER_TICK_MS / MOCK_GATHER_PER_TICK / MOCK_ALTER_MS / MOCK_CHAT_RATE_MS
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_FILE = process.env.MOCK_STATE_FILE || path.join(os.tmpdir(), 'mabi-mock-state.json');
const STOP_FLAG = `${STATE_FILE}.stop`;
const ENVELOPE = process.env.MOCK_ENVELOPE || 'nested';
const MANGLE_RAW = process.env.MOCK_MANGLE_RAW === '1';
const NO_BASE64 = process.env.MOCK_NO_BASE64 === '1';
const DISCONNECTED = process.env.MOCK_DISCONNECTED === '1';
const NEW_COMMAND = process.env.MOCK_NEW_COMMAND === '1';
const GATHER_TICK_MS = Number(process.env.MOCK_GATHER_TICK_MS || 60);
const GATHER_PER_TICK = Number(process.env.MOCK_GATHER_PER_TICK || 5);
const ALTER_MS = Number(process.env.MOCK_ALTER_MS || 400);
const CHAT_RATE_MS = Number(process.env.MOCK_CHAT_RATE_MS || 0);
const WINGS = '정령의 날개';
const COST = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_STATE = {
  wings: 200,
  gold: 123456,
  items: { 양털: 3, 통나무: 10, 거미줄: 40, '가는 실': 0 },
  altering: [],
  instrument: '류트',
  playing: null,
  fishing: false,
  sitting: false,
  lastChatAt: 0,
  chatLog: [],
};

function loadState() {
  try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch { return structuredClone(DEFAULT_STATE); }
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); }
function mutate(fn) { const s = loadState(); fn(s); saveState(s); return s; }

function emit(payload) {
  // 실제 CLI 처럼 비 ASCII 를 \uXXXX 로 이스케이프해서 출력
  const text = JSON.stringify(payload).replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  process.stdout.write(`${text}\n`);
}
function respond(status, body, { isQuery = false } = {}) {
  if (ENVELOPE === 'bare' && isQuery && status === 'accepted') return emit(body);
  if (ENVELOPE === 'nested' || Array.isArray(body) || body === null || typeof body !== 'object') return emit({ status, body });
  return emit({ status, ...body });
}
const ok = (body) => respond('accepted', body);
const data = (body) => respond('accepted', body, { isQuery: true });
const rejected = (error, message, extra = {}) => respond('rejected', { error, message, ...extra });
const invalidBody = (error, message, extra = {}) => respond('invalid_body', { error, message, ...extra });

function decodeBody(arg) {
  if (arg === undefined) return '';
  if (arg.startsWith('base64:') && !NO_BASE64) return Buffer.from(arg.slice(7), 'base64').toString('utf8');
  if (MANGLE_RAW && /[^\x00-\x7F]/.test(arg)) return arg.replace(/[^\x00-\x7F]/g, '?');
  return arg;
}
function parseJsonBody(text) {
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
const includes = (hay, needle) => String(hay).toLowerCase().includes(String(needle).toLowerCase());
const costSentence = (s) => `${WINGS} ${COST}개를 사용했습니다. (남은 수량: ${s.wings}개)`;

const GATHERABLES = [
  { DisplayName: '양털', ToolOk: true },
  { DisplayName: '두꺼운 양털', ToolOk: true },
  { DisplayName: '통나무', ToolOk: true },
  { DisplayName: '철광석', ToolOk: false },
  { DisplayName: '은붕어', ToolOk: true, fishing: true },
  { DisplayName: '막힌 버섯', ToolOk: true, blocked: true },
];
const CRAFTABLES = [
  { DisplayName: '가는 실 뭉치', Craftable: true, ProducedPerCraft: 2, Reason: null, MissingIngredients: [] },
  { DisplayName: '고급 옷감', Craftable: false, ProducedPerCraft: 1, Reason: 'not_enough_ingredient', MissingIngredients: [{ DisplayName: '가는 실', Required: 10, Owned: 0 }] },
];
const ALTERABLES = [
  { DisplayName: '가는 실', Alterable: true, ProducedPerWork: 5, Reason: null, MissingIngredients: [], facility: '물레' },
  { DisplayName: '목재', Alterable: false, ProducedPerWork: 4, Reason: 'not_enough_ingredient', MissingIngredients: [{ DisplayName: '단단한 통나무', Required: 5, Owned: 0 }], facility: '제재소' },
];
const SCORES = [
  { Location: 'inventory', DisplayTitle: '바람의 노래', IsCopyingAllowed: true, IsLocked: false },
  { Location: 'account_storage', DisplayTitle: '에린의 아침', IsCopyingAllowed: false, IsLocked: false },
];
const INSTRUMENTS = ['류트', '만돌린'];
const SOCIAL = {
  Behaviours: [
    { DisplayName: '손인사', ChatCommands: ['/손인사1'] },
    { DisplayName: '전통 댄스', ChatCommands: ['/전통댄스'] },
  ],
  Facials: [{ DisplayName: '웃음', EmojiText: '^^' }],
};
const stat = (DisplayName, Value) => ({ DisplayName, Value });

const COMMANDS = [
  'capabilities', 'get_current_environment', 'write_chat', 'get_activity', 'get_my_info', 'get_quests', 'get_currencies', 'get_near_npcs',
  'get_near_pcs', 'get_inventory', 'get_music_scores', 'play_music_score', 'get_instruments', 'change_instrument', 'get_items',
  'get_social_actions', 'stop_action', 'stand_up', 'get_daily_missions', 'get_weekly_missions', 'get_gatherable_items', 'execute_gathering',
  'get_alterable_items', 'get_altering_works', 'execute_altering', 'complete_altering_work', 'get_craftable_items', 'execute_crafting',
];

async function main() {
  const [command, rawArg] = process.argv.slice(2);
  if (!command || command === '--help') {
    process.stdout.write('mock MabinogiMobile_CLI\nusage: <command> [body]   (status | capabilities | <dispatch-command>)\n');
    return;
  }
  if (command === 'status') return emit({ pipe: DISCONNECTED ? 'disconnected' : 'connected' });
  if (DISCONNECTED) return emit({ error: 'pipe_not_connected', message: 'game client is not running' });

  const bodyText = decodeBody(rawArg);

  switch (command) {
    case 'capabilities': {
      const commands = COMMANDS.map((c) => {
        const row = { Command: c, Description: `mock ${c}`, BodyExample: '', OutputExample: '' };
        if (c === 'write_chat') row.Metadata = { requiresConfirm: 'true' };
        if (c.startsWith('execute_')) row.Note = `Running this command consumes 5 ${WINGS}.`;
        return row;
      });
      if (NEW_COMMAND) commands.push({ Command: 'get_pets', Description: 'List owned pets (new in patch)', BodyExample: '', OutputExample: 'array of { DisplayName }' });
      return data({ commands });
    }
    case 'get_pets':
      return NEW_COMMAND ? data([{ DisplayName: '잉글리시 쉽독' }]) : rejected('not_found', 'unknown command');
    case 'get_current_environment':
      return data({ ChannelDisplayName: '채널 3', GameSpaceDisplayName: '티르코네일', WorldPosition: { x: 1, y: 2, z: 3 }, Weather: '맑음', ErinnNow: '14:20', Housing: { IsInHousing: false, IsOwnedHousing: false, CanEnterHousing: true, CannotEnterHousingReason: null, CanExitHousing: false } });
    case 'get_activity': {
      const s = loadState();
      return data({
        autoPlay: { IsAutoPlaying: false, CanStartAutoPlay: true, AutoPlayTarget: 'none' },
        autoTravel: { IsAutoTraveling: false, AutoTravelRemainingPositionCount: 0 },
        combatState: { IsDead: false, IsReviving: false, IsInCombat: false },
        Dungeon: { State: 'NotInDungeon', IsBossBattleInProgress: false },
        Performance: { IsPlaying: Boolean(s.playing), InstrumentName: s.instrument || '', MusicTitle: s.playing || '' },
        Mode: { MainButtonState: s.fishing ? 'Fishing' : 'Hide', MountPartState: 'None', SitState: 'None', IsPlayingMiniGame: false, IsHousingEditMode: false },
      });
    }
    case 'get_my_info': {
      const s = loadState();
      return data({
        Title: '양이 되고 싶은', RealmName: '칼릭스', Level: stat('레벨', 87), EnabledCombatJobDisplayName: '음유시인',
        CombatScore: stat('전투력', 45210), LivingScore: stat('생활력', 3120), AttractivenessScore: stat('매력', 880), DecorScore: stat('데코 점수', 4100),
        HealthMax: stat('최대 체력', 9800), AttackPower: stat('공격력', 2100), STR: stat('힘', 120), DEX: stat('솜씨', 300), ArcaneResistance: stat('마도 저항', 3200),
        Vitals: { HealthCurrent: 9000, HealthMax: 9800, SatietyValue: 70, SatietyMax: 100, SatietyRatio: 0.7, InventoryWeightCurrent: 310, InventoryWeightMax: 800, ActiveBuffCount: 2 },
        wingsHint: s.wings,
      });
    }
    case 'get_quests': {
      const quests = [{ QuestTitle: '보름달이 비추는 에린 (3)', Source: 'event', SourceDisplayName: '이벤트', Objectives: [{ Description: '추도령과 대화', IsCompleted: false, Count: 0, Goal: 1 }] }];
      if (process.env.MOCK_GUILD_QUEST === '1') {
        quests.push({
          QuestTitle: '[주간 목표] 모험가 길드의 정기 의뢰 (1)', Source: 'pinned_sub',
          Objectives: [
            { Description: '심층 던전 클리어', IsCompleted: false, Count: 1, Goal: 3 },
            { Description: '던전 클리어', IsCompleted: true, Count: 5, Goal: 5 },
            { Description: '사냥터 임무 클리어', IsCompleted: false, Count: 0, Goal: 5 },
          ],
        });
      }
      return data(quests);
    }
    case 'get_currencies': {
      const s = loadState();
      return data([{ DisplayName: '골드', Amount: s.gold }, { DisplayName: WINGS, Amount: s.wings }, { DisplayName: '데카', Amount: 0 }, { DisplayName: '하트 토큰', Amount: 12 }, { DisplayName: '은동전', Amount: 84 }, { DisplayName: '마족 공물', Amount: 0 }]);
    }
    case 'get_near_npcs':
      return data([{ Name: 'npc_duncan', Title: '촌장', DisplayName: '던컨', Distance: 12.5 }, { Name: 'npc_nora', Title: '', DisplayName: '노라', Distance: 4.2 }]);
    case 'get_near_pcs':
      return data([{ RealmName: '칼릭스', Title: '악몽 사냥꾼', Distance: 8.1, ClothesCount: 5, Level: 100, EnabledCombatJobDisplayName: '기사', CombatScore: 90000, IsFriend: false, IsInParty: false, HasGuild: true, IsSameGuild: false, IsCoOwner: false, IsInCombat: false, Performance: { IsPlaying: false } }]);
    case 'get_inventory':
      { const cur = Number(process.env.MOCK_BAG_CURRENT || 310); return data({ CurrentInventoryWeight: cur, CurrentInventoryWeightAsDecimal: cur, MaxInventoryWeight: 800, MaxInventoryWeightAsDecimal: 800.0 }); }
    case 'get_items': {
      const filter = parseJsonBody(bodyText);
      if (filter === null) return invalidBody('invalid_json', 'body must be JSON');
      const s = loadState();
      let rows = Object.entries(s.items).filter(([, count]) => count > 0).map(([DisplayName, Count]) => ({ DisplayName, Category: 'Ingredient', CategoryDisplayName: '재료', Count, Location: 'inventory', IsLocked: false }));
      if (filter.name) rows = rows.filter((r) => includes(r.DisplayName, filter.name));
      if (filter.category) rows = rows.filter((r) => includes(r.Category, filter.category));
      return data(rows);
    }
    case 'get_music_scores':
      return data(SCORES.filter((r) => !bodyText || includes(r.DisplayTitle, bodyText)));
    case 'get_instruments': {
      const s = loadState();
      return data(INSTRUMENTS.filter((n) => !bodyText || includes(n, bodyText)).map((Name) => ({ Name, Durability: 50, IsEquipped: s.instrument === Name })));
    }
    case 'get_social_actions': {
      if (!bodyText) return data(SOCIAL);
      return data({
        Behaviours: SOCIAL.Behaviours.filter((b) => includes(b.DisplayName, bodyText) || b.ChatCommands.some((c) => includes(c, bodyText))),
        Facials: SOCIAL.Facials.filter((f) => includes(f.DisplayName, bodyText) || includes(f.EmojiText, bodyText)),
      });
    }
    case 'get_daily_missions':
      return data([
        { Title: '채집 10회', Description: '아무 채집물이나 10회 채집', CurrentCount: 4, GoalCount: 10, IsCompleted: false, IsRewardReceived: false, HasShortcut: true },
        { Title: '요리 1회', Description: '', CurrentCount: 1, GoalCount: 1, IsCompleted: true, IsRewardReceived: true, HasShortcut: false },
      ]);
    case 'get_weekly_missions':
      return data([{ Title: '어비스 1회', Description: '', CurrentCount: 0, GoalCount: 1, IsCompleted: false, IsRewardReceived: false, HasShortcut: true }]);
    case 'get_gatherable_items':
      return data({ items: GATHERABLES.filter((g) => !bodyText || includes(g.DisplayName, bodyText)).map(({ DisplayName, ToolOk }) => ({ DisplayName, ToolOk })) });
    case 'get_craftable_items':
      return data({ craftingUnlocked: true, items: CRAFTABLES.filter((c) => !bodyText || includes(c.DisplayName, bodyText) || c.MissingIngredients.some((m) => includes(m.DisplayName, bodyText))) });
    case 'get_alterable_items':
      return data({ items: ALTERABLES.filter((c) => !bodyText || includes(c.DisplayName, bodyText)).map(({ facility: _f, ...rest }) => rest) });
    case 'get_altering_works': {
      const s = loadState();
      const now = Date.now();
      const works = s.altering.map((w) => {
        const remaining = Math.max(0, Math.ceil((w.finishAt - now) / 1000));
        const done = now >= w.finishAt;
        return { DisplayName: w.DisplayName, FacilityName: w.FacilityName, State: done ? 'Completed' : 'InProgress', IsCompleted: done, RemainingSeconds: done ? 0 : remaining };
      });
      return data({ completedCount: works.filter((w) => w.IsCompleted).length, works });
    }

    // ------------------------------------------------------------ actions
    case 'write_chat': {
      const text = bodyText;
      if (!text) return invalidBody('empty_message', 'message is empty');
      if ([...text].length > 50) return invalidBody('message_too_long', 'max 50 chars', { length: [...text].length });
      const isBehaviour = SOCIAL.Behaviours.some((b) => b.ChatCommands.includes(text));
      if ((text.startsWith('/') || text.startsWith('#')) && !isBehaviour) return rejected('unsupported_command', 'reserved command');
      const s = loadState();
      if (CHAT_RATE_MS > 0 && Date.now() - s.lastChatAt < CHAT_RATE_MS) return rejected('rate_limited', 'too fast', { retryAfterSeconds: 3 });
      mutate((st) => { st.lastChatAt = Date.now(); st.chatLog = [...(st.chatLog || []), text].slice(-20); });
      return ok({ message: isBehaviour ? 'behavior executed' : 'chat sent' });
    }
    case 'play_music_score': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.title) return invalidBody('invalid_body', 'title is required');
      if (!SCORES.some((r) => r.DisplayTitle === b.title)) return rejected('not_found', 'no such score');
      const s = loadState();
      if (!s.instrument) return rejected('no_instrument', 'equip an instrument first');
      mutate((st) => { st.playing = b.title; });
      return ok({ message: 'playing' });
    }
    case 'change_instrument': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.name) return invalidBody('invalid_body', 'name is required');
      if (!INSTRUMENTS.includes(b.name)) return rejected('not_found', 'no such instrument');
      const s = loadState();
      if (s.playing) return rejected('is_playing_instrument', 'stop playing first');
      mutate((st) => { st.instrument = b.name; });
      return ok({ message: 'equipped' });
    }
    case 'stop_action': {
      const s = loadState();
      const gathering = fs.existsSync(`${STATE_FILE}.gathering`);
      if (!gathering && !s.playing && !s.fishing) return rejected('invalid_state', 'nothing to stop');
      if (gathering) fs.writeFileSync(STOP_FLAG, '1');
      mutate((st) => { st.playing = null; st.fishing = false; });
      return ok({ message: 'stopped' });
    }
    case 'stand_up': {
      const s = loadState();
      if (!s.sitting) return rejected('not_sitting', 'not sitting');
      mutate((st) => { st.sitting = false; });
      return ok({ message: 'stood up' });
    }
    case 'execute_gathering': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.displayName) return invalidBody('invalid_body', 'displayName is required');
      const target = GATHERABLES.find((g) => g.DisplayName === b.displayName);
      if (!target) return rejected('not_found', `no gatherable named ${b.displayName}`);
      if (!target.ToolOk) return rejected('tool_missing', 'required tool is missing');
      if (loadState().wings < COST) return rejected('not_enough_currency', `not enough ${WINGS}`);
      const paid = mutate((st) => { st.wings -= COST; });
      if (target.fishing) {
        mutate((st) => { st.fishing = true; });
        return ok({ result: 'started', cost: costSentence(paid) });
      }
      if (target.blocked) return ok({ error: 'blocked', kind: 'OneHourPresenceCheckPopup', message: 'user confirmation is required', gained: 0, target: 100, cost: costSentence(paid) });
      const flag = `${STATE_FILE}.gathering`;
      fs.writeFileSync(flag, String(process.pid));
      try { fs.unlinkSync(STOP_FLAG); } catch { /* 없음 */ }
      let gained = 0;
      const goal = 100;
      try {
        while (gained < goal) {
          await sleep(GATHER_TICK_MS);
          if (fs.existsSync(STOP_FLAG)) {
            fs.unlinkSync(STOP_FLAG);
            return ok({ result: 'stopped', gained, target: goal, message: 'stopped by stop_action', cost: costSentence(loadState()) });
          }
          const step = Math.min(GATHER_PER_TICK, goal - gained);
          gained += step;
          mutate((st) => { st.items[b.displayName] = (st.items[b.displayName] || 0) + step; });
        }
      } finally {
        try { fs.unlinkSync(flag); } catch { /* 없음 */ }
      }
      return ok({ result: 'completed', gained, target: goal, cost: costSentence(loadState()) });
    }
    case 'execute_crafting': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.displayName) return invalidBody('invalid_body', 'displayName is required');
      const recipe = CRAFTABLES.find((c) => c.DisplayName === b.displayName);
      if (!recipe) return rejected('not_found', 'no such recipe');
      if (!recipe.Craftable) return rejected(recipe.Reason, 'cannot craft now');
      const count = b.craftCount === undefined ? 1 : Number(b.craftCount);
      if (!Number.isInteger(count) || count < 1 || count > 10) return rejected('invalid_count', 'craftCount out of range', { maxCount: 10 });
      if (loadState().wings < COST) return rejected('not_enough_currency', `not enough ${WINGS}`);
      await sleep(150);
      const s = mutate((st) => { st.wings -= COST; st.items[recipe.DisplayName] = (st.items[recipe.DisplayName] || 0) + count * recipe.ProducedPerCraft; });
      return ok({ result: 'completed', craftCount: count, rewards: [{ DisplayName: recipe.DisplayName, Count: count * recipe.ProducedPerCraft }], criticalRewards: [], cost: costSentence(s) });
    }
    case 'execute_altering': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.displayName) return invalidBody('invalid_body', 'displayName is required');
      const recipe = ALTERABLES.find((c) => c.DisplayName === b.displayName);
      if (!recipe) return rejected('not_found', 'no such altering recipe');
      if (!recipe.Alterable) return rejected(recipe.Reason, 'cannot alter now');
      if (loadState().wings < COST) return rejected('not_enough_currency', `not enough ${WINGS}`);
      const s = mutate((st) => { st.wings -= COST; st.altering.push({ DisplayName: recipe.DisplayName, FacilityName: recipe.facility, finishAt: Date.now() + ALTER_MS, per: recipe.ProducedPerWork }); });
      return ok({ result: 'started', cost: costSentence(s) });
    }
    case 'complete_altering_work': {
      const b = parseJsonBody(bodyText);
      if (!b || !b.displayName) return invalidBody('invalid_body', 'displayName is required');
      const s = loadState();
      if (s.altering.length === 0) return rejected('no_altering', 'no altering works');
      const named = s.altering.filter((w) => w.DisplayName === b.displayName);
      if (named.length === 0) return rejected('not_found', 'no such work');
      const now = Date.now();
      if (named.every((w) => now < w.finishAt)) return rejected('not_completed_yet', 'still in progress');
      const facility = named[0].FacilityName;
      const done = s.altering.filter((w) => w.FacilityName === facility && now >= w.finishAt);
      const rewards = {};
      mutate((st) => {
        st.altering = st.altering.filter((w) => !(w.FacilityName === facility && now >= w.finishAt));
        for (const w of done) { st.items[w.DisplayName] = (st.items[w.DisplayName] || 0) + w.per; rewards[w.DisplayName] = (rewards[w.DisplayName] || 0) + w.per; }
      });
      return ok({ collected: done.length, rewards: Object.entries(rewards).map(([DisplayName, Count]) => ({ DisplayName, Count })), criticalRewards: [], message: `collected ${done.length} work(s) at ${facility}` });
    }
    default:
      return rejected('unknown_command', `unknown command: ${command}`);
  }
}

main().catch((err) => {
  process.stderr.write(`mock-cli error: ${err?.stack || err}\n`);
  process.exit(1);
});
