// 환경변수 → 서버 설정. 모든 값은 .mcp.json 의 "env" 블록에서 바꿀 수 있다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..', '..');

// 게임 클라이언트에 포함된 공식 CLI 의 기본 위치 (2026-09-17 기준)
export const DEFAULT_CLI_CANDIDATES = {
  win32: ['C:\\Nexon\\MabinogiMobile\\MabinogiMobile_CLI.exe'],
  // WSL 에서 Claude Code 를 돌리는 경우: Windows exe 를 interop 으로 직접 실행할 수 있다
  linux: ['/mnt/c/Nexon/MabinogiMobile/MabinogiMobile_CLI.exe'],
  darwin: [],
};
export const CLI_COMMAND_ON_PATH = 'MabinogiMobile_CLI';

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(value, allowed, fallback) {
  const v = String(value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

export function loadConfig(env = process.env) {
  return {
    // --- CLI 위치 / 연결 방식 ---
    cliPath: (env.MABINOGI_CLI_PATH || env.MABI_CLI_EXE || '').trim(),
    transport: oneOf(env.MABI_TRANSPORT, ['local', 'ssh'], 'local'),
    sshHost: (env.MABI_SSH_HOST || '').trim(),
    sshCliPath: (env.MABI_SSH_CLI_PATH || DEFAULT_CLI_CANDIDATES.win32[0]).trim(),
    sshOptions: (env.MABI_SSH_OPTIONS || '').trim(),
    // auto: 로컬은 원문 인자(실패 시 base64 로 1회 자동 전환), ssh 는 항상 base64
    bodyEncoding: oneOf(env.MABI_BODY_ENCODING, ['auto', 'raw', 'base64'], 'auto'),

    // --- 정령의 날개 보호 장치 ---
    wingsName: (env.MABI_WINGS_NAME || '정령의 날개').trim(),
    wingsCostPerActivity: int(env.MABI_WINGS_COST, 5, { min: 0 }),
    wingsSessionBudget: int(env.MABI_WINGS_SESSION_BUDGET, 50, { min: 0 }), // 0 = 활동 전면 차단
    wingsDailyBudget: int(env.MABI_WINGS_DAILY_BUDGET, 100, { min: 0 }), // 하루(06:00 KST 기준) 합산 상한. 세션을 새로 열어도 유지. 0 = 끔
    wingsReserve: int(env.MABI_WINGS_RESERVE, 20, { min: 0 }),
    // 날개 낭비 방지: 가방이 이 비율 이상 차 있으면 채집을 시작하지 않는다(시작하자마자 무게 초과로 끝나 5개만 날림). 0 = 끔
    bagRefusePercent: int(env.MABI_BAG_REFUSE_PERCENT, 95, { min: 0, max: 100 }),
    bagWarnPercent: int(env.MABI_BAG_WARN_PERCENT, 80, { min: 0, max: 100 }),
    // 비용이 나간 뒤 중단된 활동을 이 시간 안에 같은 조건으로 다시 시도하면 막는다(원인 해결 확인 후 retryAfterFix:true)
    retryGuardSec: int(env.MABI_RETRY_GUARD_SEC, 600, { min: 0, max: 86400 }),

    // --- 도구 묶음: core = 초보자 4대 목적(숙제·생활·채집/제작·정기 의뢰)만, full = 채팅·연주 등 전부 ---
    profile: oneOf(env.MABI_PROFILE, ['core', 'full'], 'core'),

    // --- 시간 ---
    maxWaitSec: int(env.MABI_MAX_WAIT_SEC, 45, { min: 5, max: 1500 }),
    actionTimeoutSec: int(env.MABI_ACTION_TIMEOUT_SEC, 1200, { min: 30, max: 7200 }),
    queryTimeoutSec: int(env.MABI_QUERY_TIMEOUT_SEC, 20, { min: 3, max: 300 }),
    minCallGapMs: int(env.MABI_MIN_CALL_GAP_MS, 120, { min: 0, max: 5000 }),
    watchPollSec: int(env.MABI_WATCH_POLL_SEC, 8, { min: 1, max: 120 }),

    // --- 채팅 도배 방지 ---
    chatMinIntervalSec: int(env.MABI_CHAT_MIN_INTERVAL_SEC, 10, { min: 0, max: 3600 }),
    chatMaxChars: 50,

    // --- 출력 ---
    defaultListLimit: int(env.MABI_LIST_LIMIT, 25, { min: 1, max: 500 }),
    // 목록 조회(get_*_items) 캐시: 같은 목록을 몇 초 안에 다시 읽지 않는다(CLI 프로세스 1회 ≈ 0.5초). 비용이 나가는 활동이 끝나면 비운다.
    listCacheSec: int(env.MABI_LIST_CACHE_SEC, 20, { min: 0, max: 600 }),

    // --- 감사 로그 (AI 가 게임에 보낸 모든 명령 기록) ---
    logEnabled: oneOf(env.MABI_LOG, ['on', 'off'], 'on') === 'on',
    logDir: (env.MABI_LOG_DIR || path.join(PROJECT_ROOT, 'logs')).trim(),

    // --- 숙제 트래커 (목록: homework.json, 진행 상태: homework-state.json) ---
    homeworkDir: (env.MABI_HOMEWORK_DIR || path.join(PROJECT_ROOT, 'data')).trim(),
    ledgerDir: (env.MABI_LEDGER_DIR || env.MABI_HOMEWORK_DIR || path.join(PROJECT_ROOT, 'data')).trim(),
    defaultHomeworkDefs: path.join(PROJECT_ROOT, 'data', 'homework.json'),
    // 테스트용 시계 고정(ISO 문자열). 평소에는 비워 둔다.
    nowOverride: (env.MABI_NOW || '').trim(),
  };
}
