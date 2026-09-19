#!/usr/bin/env node
// mabinogi-mcp — 마비노기 모바일 AI 커넥터(Beta)용 MCP 서버 (stdio, 의존성 없음, Node 18+)
// 프로토콜: JSON-RPC 2.0, 줄바꿈으로 구분된 JSON. stdout 은 프로토콜 전용이므로 로그는 stderr 로만 쓴다.
import readline from 'node:readline';
import { loadConfig } from './lib/config.mjs';
import { MabiCli } from './lib/cli.mjs';
import { WingsGuard, ChatGuard, WingsLedger } from './lib/guard.mjs';
import { JobManager } from './lib/jobs.mjs';
import { createToolset, SERVER_NAME, SERVER_VERSION } from './lib/tools.mjs';
import { INSTRUCTIONS } from './lib/instructions.mjs';

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const log = (msg) => process.stderr.write(`[mabinogi-mcp] ${msg}\n`);

const config = loadConfig();
const cli = new MabiCli(config, { log });
const fixedNow = config.nowOverride ? Date.parse(config.nowOverride) : NaN;
const ledger = new WingsLedger({ dir: config.ledgerDir, now: Number.isFinite(fixedNow) ? () => fixedNow : () => Date.now() });
const toolset = createToolset({ config, cli, wings: new WingsGuard(config, ledger), chatGuard: new ChatGuard(config), jobs: new JobManager() });
const inflight = new Map(); // request id → AbortController (클라이언트가 취소하면 "기다림"만 멈춘다. 게임 동작은 stop_action 으로만 멈춘다)

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

function toolResult(payload) {
  const isError = payload && payload.ok === false;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `${SERVER_NAME}-mcp`, title: '마비노기 모바일 AI 커넥터', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: toolset.list });
    case 'tools/call': {
      const name = params?.name;
      if (typeof name !== 'string' || !toolset.has(name)) return replyError(id, -32602, `Unknown tool: ${name}`);
      const controller = new AbortController();
      inflight.set(id, controller);
      const progressToken = params?._meta?.progressToken;
      const reqCtx = {
        signal: controller.signal,
        progress:
          progressToken === undefined
            ? undefined
            : (elapsed, message) => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: elapsed, message } }),
      };
      try {
        const payload = await toolset.call(name, params?.arguments, reqCtx);
        if (!controller.signal.aborted) reply(id, toolResult(payload));
      } catch (err) {
        log(`tool ${name} failed: ${err?.stack || err}`);
        if (!controller.signal.aborted) reply(id, toolResult({ ok: false, error: 'internal_error', message: String(err?.message || err) }));
      } finally {
        inflight.delete(id);
      }
      return undefined;
    }
    // 광고하지 않은 기능이라도 물어보는 클라이언트가 있어 빈 목록으로 답한다
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'resources/templates/list':
      return reply(id, { resourceTemplates: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    default:
      return replyError(id, -32601, `Method not found: ${method}`);
  }
}

function handleNotification(msg) {
  if (msg.method === 'notifications/cancelled') {
    const controller = inflight.get(msg.params?.requestId);
    if (controller) controller.abort();
  }
}

async function dispatch(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
  if (typeof msg.method === 'string') {
    if (msg.id === undefined || msg.id === null) handleNotification(msg);
    else await handleRequest(msg);
  }
  // 그 외(우리가 보낸 요청에 대한 응답 등)는 무시
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    replyError(null, -32700, 'Parse error');
    return;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const m of messages) {
    dispatch(m).catch((err) => {
      log(`dispatch error: ${err?.stack || err}`);
      if (m && m.id !== undefined && m.id !== null) replyError(m.id, -32603, 'Internal error');
    });
  }
});
rl.on('close', () => process.exit(0));
process.on('uncaughtException', (err) => log(`uncaughtException: ${err?.stack || err}`));
process.on('unhandledRejection', (err) => log(`unhandledRejection: ${err?.stack || err}`));

log(`started — profile=${config.profile}, transport=${config.transport}, budget=${config.wingsSessionBudget}/session ${config.wingsDailyBudget}/day, reserve=${config.wingsReserve}, maxWait=${config.maxWaitSec}s`);
