#!/usr/bin/env node
// 스모크 테스트: 모의 CLI 를 붙여 MCP 서버의 프로토콜·보호 장치·인코딩 전환을 검증한다.
// 실행:  node server/test/smoke.mjs      (게임 불필요, 어느 OS 에서든 동작)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '..', 'index.mjs');
const MOCK = path.resolve(here, '..', 'mock', 'mock-cli.mjs');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mabi-smoke-'));

class Client {
  constructor(name, env = {}) {
    this.stateFile = path.join(tmpRoot, `${name}.json`);
    this.child = spawn(process.execPath, [SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MABINOGI_CLI_PATH: MOCK,
        MOCK_STATE_FILE: this.stateFile,
        MABI_LOG_DIR: path.join(tmpRoot, 'logs'),
        MABI_MIN_CALL_GAP_MS: '0',
        MABI_WATCH_POLL_SEC: '1',
        MABI_CHAT_MIN_INTERVAL_SEC: '2',
        MABI_LEDGER_DIR: path.join(tmpRoot, `ledger-${name}`),
        MABI_PROFILE: 'full',
        ...env,
      },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.stderr = '';
    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line); // stdout 에 JSON 이 아닌 것이 섞이면 여기서 바로 실패한다
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        } else if (msg.method) this.notifications.push(msg);
      }
    });
    this.child.stderr.on('data', (c) => { this.stderr += c.toString('utf8'); });
  }

  request(method, params) {
    const id = this.nextId++;
    const p = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return p;
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async init() {
    const res = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    this.notify('notifications/initialized');
    return res;
  }

  async tool(name, args = {}, meta) {
    const res = await this.request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
    assert.ok(res.result, `tools/call ${name} returned an RPC error: ${JSON.stringify(res.error)}`);
    const payload = JSON.parse(res.result.content[0].text);
    return { payload, isError: res.result.isError === true };
  }

  state() { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
  close() { this.child.stdin.end(); this.child.kill(); }
}

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n    ${String(err?.message || err).split('\n').join('\n    ')}`);
  }
}

console.log('mabinogi-mcp smoke test');

await test('initialize: 프로토콜 버전 협상 + instructions + 도구 15개', async () => {
  const c = new Client('init');
  const init = await c.init();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.instructions.includes('정령의 날개'));
  assert.deepEqual(Object.keys(init.result.capabilities), ['tools']);
  const list = await c.request('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['status', 'query', 'snapshot', 'gather', 'craft', 'alter', 'collect_altered', 'play_music', 'change_instrument', 'stop_action', 'stand_up', 'chat', 'job', 'homework', 'plan_craft', 'raw_call']);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual((await c.request('ping', {})).result, {});
  assert.equal((await c.request('nope/method', {})).error.code, -32601);
  assert.equal((await c.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  c.close();
});

await test('status: 연결됨 + 카탈로그 28개 + 예산 표시', async () => {
  const c = new Client('status');
  await c.init();
  const { payload } = await c.tool('status');
  assert.equal(payload.connected, true);
  assert.equal(payload.capabilities.count, 28);
  assert.deepEqual(payload.capabilities.newCommands, []);
  assert.deepEqual(payload.capabilities.missingCommands, []);
  assert.equal(payload.wings.session, '0/50');
  assert.equal(payload.wings.today, '0/100');
  c.close();
});

await test('status: 게임 미실행 → 조치 안내', async () => {
  const c = new Client('disc', { MOCK_DISCONNECTED: '1' });
  await c.init();
  const { payload, isError } = await c.tool('status');
  assert.equal(isError, true);
  assert.equal(payload.connected, false);
  assert.ok(payload.hint.includes('AI 제어'));
  c.close();
});

await test('status: CLI 없음 → cli_not_found', async () => {
  const c = new Client('nocli', { MABINOGI_CLI_PATH: path.join(tmpRoot, 'does-not-exist.exe') });
  await c.init();
  const { payload } = await c.tool('status');
  assert.equal(payload.error, 'cli_not_found');
  c.close();
});

await test('query: 한글 필터 / 재화 맵 / 능력치 표시 이름 / 미션 압축', async () => {
  const c = new Client('query');
  await c.init();
  const g = (await c.tool('query', { command: 'get_gatherable_items', filter: '양털' })).payload;
  assert.deepEqual(g.rows.map((r) => r.DisplayName), ['양털', '두꺼운 양털']);
  const cur = (await c.tool('query', { command: 'get_currencies', filter: '정령의 날개' })).payload;
  assert.deepEqual(cur.currencies, { '정령의 날개': 200 });
  const all = (await c.tool('query', { command: 'get_currencies' })).payload;
  assert.equal(all.currencies['데카'], undefined, '0 인 재화는 생략');
  const me = (await c.tool('query', { command: 'get_my_info' })).payload;
  assert.equal(me.data['전투력'], 45210);
  assert.equal(me.data.RealmName, '칼릭스');
  const daily = (await c.tool('query', { command: 'get_daily_missions', onlyActionable: true })).payload;
  assert.equal(daily.total, 1);
  assert.equal(daily.rows[0].Progress, '4/10');
  const act = (await c.tool('query', { command: 'get_activity' })).payload;
  assert.deepEqual(act.data, { autoPlay: { CanStartAutoPlay: true }, Performance: { InstrumentName: '류트' } });
  const items = (await c.tool('query', { command: 'get_items', filter: '거미', category: 'Ingredient' })).payload;
  assert.equal(items.rows[0].Count, 40);
  const bad = (await c.tool('query', { command: 'execute_gathering' })).payload;
  assert.equal(bad.error, 'invalid_command');
  c.close();
});

await test('snapshot: 기본 섹션 묶음', async () => {
  const c = new Client('snap');
  await c.init();
  const { payload } = await c.tool('snapshot');
  assert.equal(payload.environment.GameSpaceDisplayName, '티르코네일');
  assert.equal(payload.me['레벨'], 87);
  assert.equal(payload.me.Vitals.InventoryWeightMax, 800);
  assert.equal(payload.currencies['정령의 날개'], 200);
  assert.equal(payload.daily.pending, 1);
  assert.deepEqual(payload.altering.works, []);
  c.close();
});

await test('gather: 이름 불일치는 날개를 쓰지 않고 후보 제시', async () => {
  const c = new Client('gather-miss');
  await c.init();
  const { payload } = await c.tool('gather', { displayName: '양' });
  assert.equal(payload.error, 'not_found');
  assert.deepEqual(payload.candidates, ['양털', '두꺼운 양털']);
  const tool = (await c.tool('gather', { displayName: '철광석' })).payload;
  assert.equal(tool.error, 'tool_missing');
  assert.equal((await c.tool('query', { command: 'get_currencies', filter: '정령' })).payload.currencies['정령의 날개'], 200);
  c.close();
});

await test('gather: 100개 완료 → 날개 5개 실측 차감', async () => {
  const c = new Client('gather-full', { MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '20' });
  await c.init();
  const { payload } = await c.tool('gather', { displayName: '통나무' });
  assert.equal(payload.ok, true);
  assert.equal(payload.result, 'completed');
  assert.equal(payload.gained, 100);
  assert.deepEqual(payload.wings, { spentNow: 5, balanceAfter: 195, session: '5/50', today: '5/100' });
  assert.equal(payload.perWing, 20, '날개 1개당 획득량');
  assert.equal(c.state().items['통나무'], 110);
  c.close();
});

await test('gather: stopAtCount 20 → 서버가 stop_action 으로 조기 종료', async () => {
  const c = new Client('gather-stop', { MOCK_GATHER_TICK_MS: '400', MOCK_GATHER_PER_TICK: '5' });
  await c.init();
  const { payload } = await c.tool('gather', { displayName: '양털', stopAtCount: 20 });
  assert.equal(payload.result, 'stopped');
  assert.ok(payload.gained >= 20 && payload.gained < 100, `gained=${payload.gained}`);
  assert.equal(payload.watch.stopRequested, true);
  assert.equal(payload.wings.spentNow, 5);
  c.close();
});

await test('gather: blocked(kind) 는 그대로 전달 + 비용 집계', async () => {
  const c = new Client('gather-blocked');
  await c.init();
  const { payload, isError } = await c.tool('gather', { displayName: '막힌 버섯' });
  assert.equal(isError, true);
  assert.equal(payload.error, 'blocked');
  assert.equal(payload.kind, 'OneHourPresenceCheckPopup');
  assert.ok(payload.hint.includes('자동으로 넘기'));
  assert.equal(payload.wings.spentNow, 5);
  c.close();
});

await test('job: 대기 시간이 짧으면 running → job(wait) 로 이어받기 + 진행 알림 + 동시 실행 거부', async () => {
  const c = new Client('job', { MABI_MAX_WAIT_SEC: '5', MOCK_GATHER_TICK_MS: '150', MOCK_GATHER_PER_TICK: '2' });
  await c.init();
  const first = (await c.tool('gather', { displayName: '통나무', waitSec: 1 })).payload;
  assert.equal(first.running, true);
  const busy = (await c.tool('craft', { displayName: '가는 실 뭉치' })).payload;
  assert.equal(busy.error, 'busy');
  const still = (await c.tool('job', { action: 'status' })).payload;
  assert.equal(still.running, true);
  let final = null;
  for (let i = 0; i < 6 && !final; i += 1) {
    const r = (await c.tool('job', { action: 'wait', jobId: first.job.id, waitSec: 5 }, { progressToken: 'p1' })).payload;
    if (!r.running) final = r;
  }
  assert.ok(final, '작업이 끝나야 한다');
  assert.equal(final.result, 'completed');
  assert.ok(c.notifications.some((n) => n.method === 'notifications/progress' && n.params.progressToken === 'p1'), '진행 알림');
  c.close();
});

await test('예산 보호: 세션 예산 10 → 세 번째 활동 거부 / 하한 보호', async () => {
  const c = new Client('budget', { MABI_WINGS_SESSION_BUDGET: '10', MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '50' });
  await c.init();
  assert.equal((await c.tool('craft', { displayName: '가는 실 뭉치', craftCount: 3 })).payload.result, 'completed');
  assert.equal((await c.tool('alter', { displayName: '가는 실' })).payload.result, 'started');
  const third = (await c.tool('gather', { displayName: '통나무' })).payload;
  assert.equal(third.error, 'budget_exceeded');
  assert.equal(c.state().wings, 190);
  c.close();

  const r = new Client('reserve', { MABI_WINGS_RESERVE: '198' });
  await r.init();
  assert.equal((await r.tool('gather', { displayName: '통나무' })).payload.error, 'reserve_protected');
  assert.equal(fs.existsSync(r.stateFile), false, '거부된 활동은 게임 상태를 건드리지 않는다');
  r.close();
});

await test('craft: 재료 부족은 무료로 사전 차단 / invalid_count 는 maxCount 전달', async () => {
  const c = new Client('craft');
  await c.init();
  const lack = (await c.tool('craft', { displayName: '고급 옷감' })).payload;
  assert.equal(lack.error, 'not_enough_ingredient');
  assert.deepEqual(lack.MissingIngredients, [{ DisplayName: '가는 실', Required: 10, Owned: 0 }]);
  const many = (await c.tool('craft', { displayName: '가는 실 뭉치', craftCount: 99 })).payload;
  assert.equal(many.error, 'invalid_count');
  assert.equal(many.maxCount, 10);
  assert.equal(many.wings.spentNow, 0, '거부된 호출은 비용 0');
  c.close();
});

await test('alter → collect_altered 흐름', async () => {
  const c = new Client('alter', { MOCK_ALTER_MS: '2500' });
  await c.init();
  const early = (await c.tool('collect_altered', {})).payload;
  assert.equal(early.error, 'no_altering');
  assert.equal((await c.tool('alter', { displayName: '가는 실' })).payload.result, 'started');
  const notYet = (await c.tool('collect_altered', {})).payload;
  assert.equal(notYet.error, 'no_completed_work');
  await new Promise((r) => setTimeout(r, 3000));
  const got = (await c.tool('collect_altered', {})).payload;
  assert.equal(got.collected, 1);
  assert.deepEqual(got.rewards, [{ DisplayName: '가는 실', Count: 5 }]);
  assert.equal(got.wings.spentNow, 0);
  c.close();
});

await test('연주: 악기 교체 + 연주 + 정지', async () => {
  const c = new Client('music');
  await c.init();
  const miss = (await c.tool('play_music', { title: '바람' })).payload;
  assert.deepEqual(miss.candidates, ['바람의 노래']);
  const played = (await c.tool('play_music', { title: '바람의 노래', instrument: '만돌린' })).payload;
  assert.equal(played.ok, true);
  assert.equal(c.state().instrument, '만돌린');
  assert.equal(c.state().playing, '바람의 노래');
  assert.equal((await c.tool('change_instrument', { name: '류트' })).payload.error, 'is_playing_instrument');
  assert.equal((await c.tool('stop_action')).payload.ok, true);
  assert.equal((await c.tool('stop_action')).payload.error, 'invalid_state');
  assert.equal((await c.tool('stand_up')).payload.error, 'not_sitting');
  c.close();
});

await test('chat: 승인 없으면 거부 / 50자 제한 / 도배 간격 / 한글 원문 보존', async () => {
  const c = new Client('chat');
  await c.init();
  const noApproval = (await c.tool('chat', { message: '안녕하세요', approvedByUser: false })).payload;
  assert.equal(noApproval.error, 'approval_required');
  assert.equal(noApproval.pendingMessage, '안녕하세요');
  assert.equal((await c.tool('chat', { message: '가'.repeat(51), approvedByUser: true })).payload.error, 'message_too_long');
  const sent = (await c.tool('chat', { message: '안녕하세요! 양털 구해요', approvedByUser: true })).payload;
  assert.equal(sent.ok, true);
  assert.deepEqual(c.state().chatLog, ['안녕하세요! 양털 구해요']);
  const again = (await c.tool('chat', { message: '한 번 더', approvedByUser: true })).payload;
  assert.equal(again.error, 'chat_throttled');
  assert.ok(again.retryAfterSeconds >= 1);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal((await c.tool('chat', { message: '/지역', approvedByUser: true })).payload.error, 'unsupported_command');
  c.close();
});

await test('인코딩: 원문 한글이 깨지는 환경 → base64 로 자동 전환, 채팅도 안전', async () => {
  const c = new Client('enc', { MOCK_MANGLE_RAW: '1' });
  await c.init();
  const sent = (await c.tool('chat', { message: '반가워요', approvedByUser: true })).payload;
  assert.equal(sent.ok, true);
  assert.deepEqual(c.state().chatLog, ['반가워요'], '깨진 글자가 전송되면 안 된다');
  const g = (await c.tool('query', { command: 'get_gatherable_items', filter: '통나무' })).payload;
  assert.deepEqual(g.rows.map((r) => r.DisplayName), ['통나무', '단단한 통나무']);
  const st = (await c.tool('status')).payload;
  assert.equal(st.cli.bodyEncoding, 'base64');
  assert.equal(st.cli.encodingConfirmed, true);
  c.close();
});

await test('응답 봉투: flat / bare 형식도 파싱', async () => {
  for (const envelope of ['flat', 'bare']) {
    const c = new Client(`env-${envelope}`, { MOCK_ENVELOPE: envelope, MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '50' });
    await c.init();
    assert.equal((await c.tool('status')).payload.capabilities.count, 28, envelope);
    assert.equal((await c.tool('snapshot')).payload.currencies['정령의 날개'], 200, envelope);
    const gathered = (await c.tool('gather', { displayName: '통나무' })).payload;
    assert.equal(gathered.result, 'completed', envelope);
    assert.equal(gathered.wings.spentNow, 5, envelope);
    assert.equal((await c.tool('gather', { displayName: '없는것' })).payload.error, 'not_found', envelope);
    c.close();
  }
});

await test('패치 대응: 새 명령 감지 + raw_call / 전용 도구 우회 차단', async () => {
  const c = new Client('drift', { MOCK_NEW_COMMAND: '1' });
  await c.init();
  const st = (await c.tool('status')).payload;
  assert.deepEqual(st.capabilities.newCommands, ['get_pets']);
  const raw = (await c.tool('raw_call', { command: 'get_pets' })).payload;
  assert.equal(raw.ok, true);
  assert.equal((await c.tool('raw_call', { command: 'execute_gathering', body: { displayName: '통나무' } })).payload.error, 'use_dedicated_tool');
  assert.equal((await c.tool('raw_call', { command: 'open_marketplace' })).payload.error, 'unknown_command');
  c.close();
});

// ------------------------------------------------------------------ 숙제 트래커
const HOMEWORK_DEFS = path.resolve(here, '..', '..', 'data', 'homework.json');
function homeworkDir(name) {
  const dir = path.join(tmpRoot, `hw-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(HOMEWORK_DEFS, path.join(dir, 'homework.json'));
  return dir;
}
const findRow = (board, id) => board.groups.flatMap((g) => g.items).find((r) => r.id === id);

await test('숙제: 보드 + 게임 미션 자동 동기화 + 초기화/출현 시각 계산', async () => {
  // 2026-09-19(토) 09:30 KST
  const c = new Client('hw-list', { MABI_HOMEWORK_DIR: homeworkDir('list'), MABI_NOW: '2026-09-19T00:30:00Z' });
  await c.init();
  const { payload } = await c.tool('homework', { action: 'list', detail: true });
  assert.equal(payload.sync.synced, true);
  assert.ok(payload.now.startsWith('2026-09-19(토) 09:30'));
  assert.equal(payload.reset.daily, '09-20(일) 06:00 (20시간 30분 뒤)');
  assert.equal(payload.reset.weekly, '09-21(월) 06:00 (1일 20시간 뒤)');
  assert.equal(findRow(payload, 'daily_mission').progress, '1/2', '일일 미션은 보상 수령 기준으로 자동 반영');
  assert.equal(findRow(payload, 'weekly_mission').progress, '0/1');
  assert.equal(findRow(payload, 'black_hole_weekly').left, 7);
  assert.equal(findRow(payload, 'tower_of_wraith'), undefined, 'legacy 프리셋은 기본으로 꺼져 있다');
  assert.equal(findRow(payload, 'fieldboss_weekly').left, 1, '필드 보스 토벌 전리품은 주 1회(보스 합산)');
  assert.equal(findRow(payload, 'raid_cavrak'), undefined, '레이드는 체크리스트에서 제외');
  assert.equal(findRow(payload, 'abyss_1'), undefined, '어비스는 체크리스트에서 제외');
  assert.deepEqual(payload.selfPlay.names, ['어비스 (룬다 어비스)', '레이드', '뱅가드 브리치']);
  assert.deepEqual(payload.upcoming.map((u) => u.at).sort(), ['10:00', '12:00']);
  c.close();
});

await test('숙제: 체크하면 목록에서 빠진다(전리품 남은 것만) / 그룹 일괄 / 후보 제시', async () => {
  const c = new Client('hw-check', { MABI_HOMEWORK_DIR: homeworkDir('check'), MABI_NOW: '2026-09-19T00:30:00Z', MOCK_DISCONNECTED: '1' });
  await c.init();
  const before = (await c.tool('homework', { action: 'list', detail: true })).payload;
  assert.equal(before.sync.synced, false, '게임이 꺼져 있어도 수동 기록은 동작');
  const one = (await c.tool('homework', { action: 'check', item: '검구' })).payload;
  assert.deepEqual(one.changed, [{ name: '검은 구멍 (일일)', progress: '1/1', done: true }]);
  const bosses = (await c.tool('homework', { action: 'check', group: '필드 보스', all: true })).payload;
  assert.equal(bosses.changed.length, 1, '필드 보스는 주 1회짜리 항목 하나');
  const partial = (await c.tool('homework', { action: 'check', item: '결계', count: 3 })).payload;
  assert.equal(partial.changed[0].progress, '3/7');
  const after = (await c.tool('homework', { action: 'list', sync: false, detail: true })).payload;
  assert.equal(findRow(after, 'black_hole_daily'), undefined);
  assert.equal(findRow(after, 'fieldboss_weekly'), undefined);
  assert.equal(findRow(after, 'barrier_weekly').left, 4);
  assert.equal(after.summary.hiddenDone, 2);
  const full = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
  assert.equal(findRow(full, 'fieldboss_weekly').done, true);
  for (const what of ['어비스', '카브락']) {
    const guideOnly = (await c.tool('homework', { action: 'check', item: what })).payload;
    assert.equal(guideOnly.error, 'guide_only', what);
  }
  assert.equal((await c.tool('homework', { action: 'check', group: '레이드', all: true })).payload.error, 'guide_only');
  const ambiguous = (await c.tool('homework', { action: 'check', item: '미션' })).payload;
  assert.equal(ambiguous.error, 'not_found');
  assert.ok(ambiguous.candidates.length >= 3, '일일/주간/길드 미션 중 어느 것인지 물어야 한다');
  assert.equal((await c.tool('homework', { action: 'check', item: '크라마' })).payload.changed[0].name, '필드 보스 토벌 전리품', '보스 이름은 주 1회 항목의 별칭');
  const undo = (await c.tool('homework', { action: 'uncheck', item: 'black_hole_daily' })).payload;
  assert.equal(undo.changed[0].progress, '0/1');
  c.close();
});

await test('숙제: 일일은 매일 06시, 주간은 월요일 06시에 초기화', async () => {
  const dir = homeworkDir('reset');
  const at = async (iso, fn) => {
    const c = new Client(`hw-reset-${iso}`, { MABI_HOMEWORK_DIR: dir, MABI_NOW: iso, MOCK_DISCONNECTED: '1' });
    await c.init();
    await fn(c);
    c.close();
  };
  await at('2026-09-19T00:30:00Z', async (c) => { // 토 09:30
    await c.tool('homework', { action: 'check', item: 'black_hole_daily' });
    await c.tool('homework', { action: 'check', item: '크라마' });
  });
  await at('2026-09-19T20:30:00Z', async (c) => { // 일 05:30 — 아직 토요일 게임 날짜
    const b = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
    assert.equal(findRow(b, 'black_hole_daily').done, true);
  });
  await at('2026-09-19T21:30:00Z', async (c) => { // 일 06:30 — 일일 초기화됨, 주간은 유지
    const b = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
    assert.equal(findRow(b, 'black_hole_daily').progress, '0/1');
    assert.equal(findRow(b, 'fieldboss_weekly').done, true);
  });
  await at('2026-09-20T20:30:00Z', async (c) => { // 월 05:30 — 주간 아직 유지
    const b = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
    assert.equal(findRow(b, 'fieldboss_weekly').done, true);
  });
  await at('2026-09-20T21:30:00Z', async (c) => { // 월 06:30 — 주간 초기화
    const b = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
    assert.equal(findRow(b, 'fieldboss_weekly').progress, '0/1');
    assert.equal(b.reset.weekly, '09-28(월) 06:00 (6일 23시간 뒤)');
  });
});

await test('숙제: 프리셋 켜기 / 사용자 항목 / 캐릭터 프로필(계정 공유 항목은 공유)', async () => {
  const c = new Client('hw-custom', { MABI_HOMEWORK_DIR: homeworkDir('custom'), MABI_NOW: '2026-09-19T00:30:00Z', MOCK_DISCONNECTED: '1' });
  await c.init();
  const enabled = (await c.tool('homework', { action: 'enable', group: 'preset:barter' })).payload;
  assert.ok(enabled.enabled.length >= 5);
  const withBarter = (await c.tool('homework', { action: 'list', sync: false, detail: true })).payload;
  assert.deepEqual(findRow(withBarter, 'barter_alissa_scrap').materials, [{ gather: '달걀', count: 10 }]);
  const added = (await c.tool('homework', { action: 'add', name: '재배 화분 물주기', cycle: 'daily', count: 1 })).payload;
  assert.equal(added.ok, true);
  assert.equal((await c.tool('homework', { action: 'check', item: '화분' })).payload.changed[0].done, true);
  assert.equal((await c.tool('homework', { action: 'remove', item: '검구' })).payload.error, 'invalid_state', '기본 항목은 삭제 대신 끄기');
  assert.equal((await c.tool('homework', { action: 'remove', item: '화분' })).payload.ok, true);

  await c.tool('homework', { action: 'check', item: 'black_hole_daily' });
  await c.tool('homework', { action: 'check', item: '무료 상품' });
  assert.equal((await c.tool('homework', { action: 'check', item: '길드 미션', count: 2 })).payload.changed[0].progress, '2/6', '길드 미션은 주 6개');
  const alt = (await c.tool('homework', { action: 'characters', character: '부캐' })).payload;
  assert.deepEqual(alt.characters, ['기본', '부캐']);
  assert.equal(alt.active, '부캐');
  const altBoard = (await c.tool('homework', { action: 'list', sync: false, pendingOnly: false, detail: true })).payload;
  assert.equal(altBoard.character, '부캐');
  assert.equal(findRow(altBoard, 'black_hole_daily').progress, '0/1', '캐릭터 항목은 프로필별');
  assert.equal(findRow(altBoard, 'cashshop_free').done, true, '계정 항목은 공유');
  assert.equal(findRow(altBoard, 'guild_mission').progress, '2/6');
  assert.equal((await c.tool('homework', { action: 'list', character: '없는캐릭' })).payload.error, 'not_found');
  c.close();
});

await test('숙제: 정기 의뢰 plan — 게임 진행도 + 사용자 공략 설정 + 재화', async () => {
  const c = new Client('hw-plan', { MABI_HOMEWORK_DIR: homeworkDir('plan'), MABI_NOW: '2026-09-19T00:30:00Z', MOCK_GUILD_QUEST: '1' });
  await c.init();
  const { payload } = await c.tool('homework', { action: 'plan' });
  assert.equal(payload.source, 'game');
  assert.equal(payload.questTitle, '[주간 목표] 모험가 길드의 정기 의뢰 (1)');
  assert.deepEqual(payload.steps.map((s) => [s.objective, s.progress, s.left, s.where, s.difficulty ?? null, s.doubleLoot]), [
    ['심층 던전 클리어', '1/3', 2, '페카 고분 심층', '어려움', false],
    ['던전 클리어', '5/5', 0, '피오드 던전', null, true],
    ['사냥터 임무 클리어', '0/5', 5, '창백한 산', null, true],
  ]);
  assert.equal(payload.allDone, false);
  assert.deepEqual(payload.currencies, { '정령의 날개': 200, 은동전: 84, '마족 공물': 0 });
  const board = (await c.tool('homework', { action: 'list', detail: true })).payload;
  assert.equal(findRow(board, 'guild_weekly_request').progress, '1/3', 'plan 조회가 보드 진행도도 갱신');
  c.close();

  const off = new Client('hw-plan-off', { MABI_HOMEWORK_DIR: homeworkDir('plan-off'), MABI_NOW: '2026-09-19T00:30:00Z', MOCK_DISCONNECTED: '1' });
  await off.init();
  const fb = (await off.tool('homework', { action: 'plan', item: '정기 의뢰' })).payload;
  assert.equal(fb.source, 'fallback');
  assert.deepEqual(fb.steps.map((s) => [s.objective, s.left, s.where, s.unverified]), [['심층 던전', 3, '페카 고분 심층', true], ['던전', 5, '피오드 던전', true], ['사냥터', 5, '창백한 산', true]]);
  off.close();
});

await test('숙제: 어비스·레이드는 체크리스트 대신 가이드(내 스펙과 입장 조건 비교)', async () => {
  const c = new Client('hw-guide', { MABI_HOMEWORK_DIR: homeworkDir('guide'), MABI_NOW: '2026-09-19T00:30:00Z' });
  await c.init();
  const { payload } = await c.tool('homework', { action: 'guide', item: '에이렐' });
  assert.equal(payload.guides.length, 1);
  assert.equal(payload.guides[0].id, 'raid');
  assert.equal(payload.me.combatScore, 45210);
  assert.equal(payload.me.arcaneResistance, 3200);
  const req = payload.guides[0].requirements[0];
  assert.equal(req.label, '에이렐 매우 어려움');
  assert.equal(req.combatScoreGap, 45210 - 88500);
  assert.equal(req.arcaneResistanceGap, 200);
  assert.equal(req.meets, false);
  assert.ok(payload.principle.includes('직접 플레이'));
  const all = (await c.tool('homework', { action: 'guide' })).payload;
  assert.deepEqual(all.guides.map((g) => g.id), ['abyss', 'raid', 'vanguard']);
  const vg = (await c.tool('homework', { action: 'guide', item: '뱅가드' })).payload.guides[0];
  assert.equal(vg.requirements[0].meets, true, '전투력 45,210 ≥ 21,300');
  c.close();

  const off = new Client('hw-guide-off', { MABI_HOMEWORK_DIR: homeworkDir('guide-off'), MABI_NOW: '2026-09-19T00:30:00Z', MOCK_DISCONNECTED: '1' });
  await off.init();
  const offline = (await off.tool('homework', { action: 'guide', item: '어비스' })).payload;
  assert.equal(offline.me, undefined);
  assert.ok(offline.meNote);
  assert.ok(offline.guides[0].loot.includes('주 3회'));
  assert.equal(offline.guides[0].requirements[1].meets, undefined, '연결이 없으면 비교하지 않는다');
  // 원하면 다시 체크리스트로 되돌릴 수 있다
  await off.tool('homework', { action: 'enable', group: 'preset:raid-abyss' });
  assert.equal((await off.tool('homework', { action: 'check', item: '카브락' })).payload.changed[0].done, true);
  off.close();
});

await test('snapshot gear: 쓸 수 있는 도구가 없는 채집물 + 악기 내구도 + 수리 안내', async () => {
  const c = new Client('gear');
  await c.init();
  const { payload } = await c.tool('snapshot', { sections: ['gear'] });
  assert.deepEqual(payload.gear.gatherables.noUsableTool, ['철광석']);
  assert.equal(payload.gear.gatherables.total, 7);
  assert.deepEqual(payload.gear.instruments.map((i) => i.Name), ['류트', '만돌린']);
  assert.equal(payload.gear.advice, undefined);
  const broken = (await c.tool('gather', { displayName: '철광석' })).payload;
  assert.ok(broken.hint.includes('여분 도구'));
  c.close();
});

await test('core 묶음: 핵심 도구 11개만 노출(토큰 절약), 나머지는 호출도 불가', async () => {
  const c = new Client('core', { MABI_PROFILE: 'core' });
  await c.init();
  const tools = (await c.request('tools/list', {})).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['status', 'query', 'snapshot', 'gather', 'craft', 'alter', 'collect_altered', 'stop_action', 'job', 'homework', 'plan_craft']);
  assert.ok(JSON.stringify(tools).length < 8500, `core 도구 정의가 너무 큼: ${JSON.stringify(tools).length}`);
  assert.equal((await c.request('tools/call', { name: 'chat', arguments: { message: 'hi', approvedByUser: true } })).error.code, -32602);
  c.close();
});

await test('날개 절약: 가방이 거의 차면 채집을 시작하지 않는다 / 80% 이상이면 경고', async () => {
  const full = new Client('bag-full', { MOCK_BAG_CURRENT: '790' });
  await full.init();
  const refused = (await full.tool('gather', { displayName: '통나무' })).payload;
  assert.equal(refused.error, 'bag_nearly_full');
  assert.equal(refused.bagPercent, 99);
  assert.equal(fs.existsSync(full.stateFile), false, '날개를 쓰지 않았다');
  full.close();
  const warn = new Client('bag-warn', { MOCK_BAG_CURRENT: '700', MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '50' });
  await warn.init();
  const ok = (await warn.tool('gather', { displayName: '통나무' })).payload;
  assert.equal(ok.result, 'completed');
  assert.ok(ok.bagWarning.includes('88%'));
  warn.close();
});

await test('날개 절약: 비용이 나간 뒤 중단된 활동의 즉시 재시도 차단', async () => {
  const c = new Client('retry-guard');
  await c.init();
  assert.equal((await c.tool('gather', { displayName: '막힌 버섯' })).payload.error, 'blocked');
  const again = (await c.tool('gather', { displayName: '막힌 버섯' })).payload;
  assert.equal(again.error, 'recent_failure');
  assert.equal(again.previous, 'blocked');
  assert.equal(again.previousKind, 'OneHourPresenceCheckPopup');
  assert.equal(c.state().wings, 195, '두 번째 시도는 날개를 쓰지 않았다');
  assert.equal((await c.tool('gather', { displayName: '통나무', waitSec: 1 })).payload.error, undefined, '다른 활동은 막지 않는다');
  await c.tool('stop_action');
  for (let i = 0; i < 20 && (await c.tool('job', { action: 'status' })).payload.running; i += 1) await new Promise((r) => setTimeout(r, 200));
  const forced = (await c.tool('gather', { displayName: '막힌 버섯', retryAfterFix: true })).payload;
  assert.equal(forced.error, 'blocked', '사용자가 해결을 확인하면 다시 시도할 수 있다');
  c.close();
});

await test('날개 절약: 하루 상한은 세션(서버)을 새로 열어도 유지된다', async () => {
  const ledgerDir = path.join(tmpRoot, 'ledger-shared');
  const env = { MABI_LEDGER_DIR: ledgerDir, MABI_WINGS_DAILY_BUDGET: '10', MABI_NOW: '2026-09-19T00:30:00Z', MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '50' };
  const a = new Client('day-a', env);
  await a.init();
  assert.equal((await a.tool('gather', { displayName: '통나무' })).payload.wings.today, '5/10');
  a.close();
  const b = new Client('day-b', env);
  await b.init();
  assert.equal((await b.tool('status')).payload.wings.today, '5/10');
  assert.equal((await b.tool('craft', { displayName: '가는 실 뭉치' })).payload.wings.today, '10/10');
  assert.equal((await b.tool('alter', { displayName: '가는 실' })).payload.error, 'daily_budget_exceeded');
  b.close();
  const nextDay = new Client('day-c', { ...env, MABI_NOW: '2026-09-19T21:30:00Z' }); // 다음 날 06:30 KST
  await nextDay.init();
  assert.equal((await nextDay.tool('status')).payload.wings.today, '0/10', '06시에 하루 상한 초기화');
  nextDay.close();
});

await test('숙제 보드 압축 출력: 1,100자 이내', async () => {
  const c = new Client('hw-compact', { MABI_HOMEWORK_DIR: homeworkDir('compact'), MABI_NOW: '2026-09-19T00:30:00Z' });
  await c.init();
  const res = await c.request('tools/call', { name: 'homework', arguments: { action: 'list' } });
  const text = res.result.content[0].text;
  const board = JSON.parse(text);
  assert.ok(text.length < 1100, `보드가 너무 큼: ${text.length}자`);
  assert.equal(board.sync, 'ok');
  assert.ok(board.left['일일'].includes('일일 미션 1/2'));
  assert.ok(board.left['주간'].includes('검은 구멍 (주간 초과) 0/7'));
  assert.ok(board.left['필드 보스'].includes('필드 보스 토벌 전리품'));
  assert.ok(board.upcoming.includes('10:00'));
  assert.ok(board.selfPlay.includes('직접 플레이'));
  c.close();
});

await test('정기 의뢰 plan: 재화 소모 계산(남은 횟수×입장 비용×더블 루팅) + 입장 레벨 경고', async () => {
  const dir = homeworkDir('plan-cost');
  const file = path.join(dir, 'homework.json');
  const defs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const objectives = defs.items.find((i) => i.id === 'guild_weekly_request').plan.objectives;
  objectives.find((o) => o.match === '심층').costPerRun = 2;
  objectives.find((o) => o.match === '사냥터').costPerRun = 8;
  fs.writeFileSync(file, JSON.stringify(defs));
  const c = new Client('hw-plan-cost', { MABI_HOMEWORK_DIR: dir, MABI_NOW: '2026-09-19T00:30:00Z', MOCK_GUILD_QUEST: '1' });
  await c.init();
  const { payload } = await c.tool('homework', { action: 'plan' });
  const [deep, dungeon, field] = payload.steps;
  assert.deepEqual(deep.spend, { currency: '마족 공물', runs: 2, need: 4, have: 0, short: 4, recoverIn: '2일 0시간' });
  assert.ok(deep.levelTooLow.includes('Lv.95'), '모의 캐릭터는 Lv.87');
  assert.equal(dungeon.spend, undefined, '끝난 목표는 계산하지 않는다');
  assert.deepEqual(field.spend, { currency: '은동전', runs: 5, need: 80, have: 84, short: 0 });
  assert.equal(payload.notes, undefined, '참고 문장은 detail 일 때만');
  c.close();

  // 더블 루팅 1판이 클리어 2회로 세어지는 경우: 남은 5회 → 3판 × 10 × 2배 = 60
  objectives.find((o) => o.match === '사냥터').costPerRun = 10;
  objectives.find((o) => o.match === '사냥터').doubleLootCountsTwice = true;
  fs.writeFileSync(file, JSON.stringify(defs));
  const d = new Client('hw-plan-cost2', { MABI_HOMEWORK_DIR: dir, MABI_NOW: '2026-09-19T00:30:00Z', MOCK_GUILD_QUEST: '1' });
  await d.init();
  const twice = (await d.tool('homework', { action: 'plan' })).payload.steps[2].spend;
  assert.deepEqual(twice, { currency: '은동전', runs: 3, need: 60, have: 84, short: 0 });
  d.close();
});

await test('감사 로그(JSONL) 기록', async () => {
  const dir = path.join(tmpRoot, 'logs');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.ok(files.length >= 1);
  const lines = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.command === 'execute_gathering' && l.status === 'accepted'));
  assert.ok(lines.some((l) => l.command === 'write_chat' && l.body === '안녕하세요! 양털 구해요'));
});

await test('날개 절약: 가방이 거의 차면 제작도 시작하지 않는다', async () => {
  const c = new Client('craft-bag-full', { MOCK_BAG_CURRENT: '790' });
  await c.init();
  const refused = (await c.tool('craft', { displayName: '가는 실 뭉치', craftCount: 5 })).payload;
  assert.equal(refused.error, 'bag_nearly_full');
  assert.equal(refused.bagPercent, 99);
  assert.equal(fs.existsSync(c.stateFile), false, '날개를 쓰지 않았다');
  c.close();
});

await test('채집 후 새로 열린 채집물(newGatherables)로 생활 레벨 상승을 알린다', async () => {
  const c = new Client('unlock', { MOCK_UNLOCK_AFTER_GATHER: '황금 양털', MOCK_GATHER_TICK_MS: '5', MOCK_GATHER_PER_TICK: '50' });
  await c.init();
  const first = (await c.tool('gather', { displayName: '양털' })).payload;
  assert.equal(first.result, 'completed');
  assert.deepEqual(first.newGatherables, ['황금 양털']);
  assert.ok(first.next.includes('레벨'));
  const second = (await c.tool('gather', { displayName: '양털' })).payload;
  assert.equal(second.result, 'completed');
  assert.equal(second.newGatherables, undefined, '이미 열린 것은 다시 알리지 않는다');
  c.close();
});

await test('토큰 절약: compact:false(원본) 조회에도 limit 이 적용된다', async () => {
  const c = new Client('raw-limit');
  await c.init();
  const raw = (await c.tool('query', { command: 'get_gatherable_items', compact: false, limit: 2 })).payload;
  assert.equal(raw.ok, true);
  assert.equal(raw.data.items.length, 2);
  assert.equal(raw.truncated, true);
  assert.ok(raw.total > 2);
  c.close();
});

await test('plan_craft: 부족 재료를 따라 내려가 채집→가공→제작 계획과 비용을 만든다(무료)', async () => {
  const c = new Client('plan');
  await c.init();
  const p = (await c.tool('plan_craft', { displayName: '활', count: 2 })).payload;
  assert.equal(p.ok, true);
  assert.deepEqual(p.steps.map((s) => [s.kind, s.displayName, s.qty]), [['gather', '단단한 통나무', 10], ['alter', '목재', 6], ['craft', '활', 2]]);
  assert.equal(p.steps[0].calls, 1);
  assert.equal(p.steps[1].works, 2);
  assert.equal(p.steps[2].runs, 2);
  assert.equal(p.wings.estimated, 20, '채집 5 + 가공 2건 10 + 제작 5');
  assert.equal(p.wings.alterShare, 10);
  assert.equal(fs.existsSync(c.stateFile), false, '계획은 날개를 쓰지 않는다');
  const locked = (await c.tool('plan_craft', { displayName: '판금 투구S' })).payload;
  assert.equal(locked.steps.length, 0, '빈 steps 도 배열로 온다');
  assert.equal(locked.manual[0].reason, 'insufficient_living_skill_level');
  const none = (await c.tool('plan_craft', { displayName: '없는 것' })).payload;
  assert.equal(none.error, 'not_found');
  c.close();
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 무시 */ }
process.exit(failed.length ? 1 : 0);
