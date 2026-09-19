// 공식 CLI(MabinogiMobile_CLI.exe) 실행기.
// CLI 는 1회 호출 → JSON 출력 → 종료하는 one-shot 프로그램이며, 실행 중인 게임과 named pipe 로 통신한다.
// 이 모듈은 CLI 를 "있는 그대로" 호출만 한다. 게임/CLI 를 변조하거나 우회하지 않는다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CLI_CANDIDATES, CLI_COMMAND_ON_PATH } from './config.mjs';

const COMMAND_RE = /^[a-z][a-z0-9_]{0,63}$/;
const NON_ASCII_RE = /[^\x20-\x7E]/;
const SHELL_SAFE_RE = /^[A-Za-z0-9_.:=+\/-]*$/;
const SSH_HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@:\-\[\]]*$/;
const SCRIPT_EXT_RE = /\.(mjs|cjs|js)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CLI 응답을 { status, body } 로 정규화한다. 봉투가 있든(flat/nested) 없든 처리. */
export function normalizeResponse(parsed) {
  let value = parsed;
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.status === 'string') {
    let body;
    if ('body' in value) {
      body = value.body;
      if (typeof body === 'string') {
        const t = body.trim();
        if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
          try { body = JSON.parse(t); } catch { /* 문자열 그대로 둔다 */ }
        }
      }
    } else {
      const { status: _s, ...rest } = value;
      body = rest;
    }
    return { status: value.status, body };
  }
  return { status: 'unknown', body: value };
}

export function errorCodeOf(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') return body.error;
  return undefined;
}

/** 필터를 줬는데 결과가 완전히 비었는가? (인코딩 깨짐 의심 신호) */
export function isEmptyResult(body) {
  if (Array.isArray(body)) return body.length === 0;
  if (body && typeof body === 'object') {
    const arrays = Object.values(body).filter(Array.isArray);
    return arrays.length > 0 && arrays.every((a) => a.length === 0);
  }
  return false;
}

export class MabiCli {
  constructor(config, { log = () => {} } = {}) {
    this.config = config;
    this.log = log;
    this.resolvedPath = null;
    this.preferredEncoding = config.bodyEncoding === 'base64' ? 'base64' : 'raw';
    this.encodingConfirmed = config.bodyEncoding !== 'auto' || config.transport === 'ssh';
    this.queue = Promise.resolve();
    this.lastCallAt = 0;
    this.callCount = 0;
  }

  describe() {
    return {
      transport: this.config.transport,
      cliPath: this.config.transport === 'ssh' ? `${this.config.sshHost}:${this.config.sshCliPath}` : this.resolveCliPath(),
      bodyEncoding: this.config.transport === 'ssh' ? 'base64' : this.preferredEncoding,
      encodingConfirmed: this.encodingConfirmed,
      cliCalls: this.callCount,
    };
  }

  resolveCliPath() {
    if (this.resolvedPath) return this.resolvedPath;
    if (this.config.cliPath) {
      this.resolvedPath = this.config.cliPath;
    } else {
      const candidates = DEFAULT_CLI_CANDIDATES[process.platform] || [];
      this.resolvedPath = candidates.find((p) => fs.existsSync(p)) || CLI_COMMAND_ON_PATH;
    }
    return this.resolvedPath;
  }

  /**
   * CLI 명령 1회 실행.
   * @param {string} command  capabilities 에 있는 명령 이름
   * @param {string|object|undefined} body  원문 문자열 또는 JSON 객체
   * @param {{timeoutSec?: number, long?: boolean}} opts  long=true 면 짧은 호출 큐를 막지 않는다
   */
  call(command, body, { timeoutSec, long = false } = {}) {
    if (!COMMAND_RE.test(String(command))) {
      return Promise.resolve(this.#wrapperError('invalid_command', `허용되지 않는 명령 형식: ${command}`));
    }
    const bodyStr = body === undefined || body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const timeout = timeoutSec ?? (long ? this.config.actionTimeoutSec : this.config.queryTimeoutSec);
    const run = () => this.#callWithEncoding(command, bodyStr, timeout);
    return this.#enqueue(run, { hold: !long });
  }

  /** 채팅처럼 "성공했는데 글자가 깨진" 경우를 되돌릴 수 없는 명령 전에 인코딩을 확정한다. */
  async ensureEncodingConfirmed() {
    if (this.encodingConfirmed) return true;
    // 무해한 조회로 확인: 행동 목록에서 한글 필터가 먹히는지 본다.
    const probe = await this.call('get_social_actions', '인사');
    return this.encodingConfirmed || (probe.transportOk && !isEmptyResult(probe.body));
  }

  // ------------------------------------------------------------------ internals

  #enqueue(fn, { hold }) {
    const gate = this.queue.then(async () => {
      const wait = this.lastCallAt + this.config.minCallGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
    });
    if (hold) {
      const p = gate.then(fn);
      this.queue = p.then(() => { this.lastCallAt = Date.now(); }, () => {});
      return p;
    }
    this.queue = gate.catch(() => {});
    return gate.then(fn);
  }

  #pickEncoding(bodyStr) {
    if (bodyStr === '') return 'none';
    if (this.config.transport === 'ssh') return SHELL_SAFE_RE.test(bodyStr) ? 'raw' : 'base64';
    if (this.config.bodyEncoding === 'base64') return 'base64';
    if (this.config.bodyEncoding === 'raw') return 'raw';
    return NON_ASCII_RE.test(bodyStr) ? this.preferredEncoding : 'raw';
  }

  async #callWithEncoding(command, bodyStr, timeoutSec) {
    const mode = this.#pickEncoding(bodyStr);
    const first = await this.#invoke(command, bodyStr, mode, timeoutSec);

    const undecided =
      this.config.bodyEncoding === 'auto' &&
      this.config.transport === 'local' &&
      !this.encodingConfirmed &&
      bodyStr !== '' &&
      NON_ASCII_RE.test(bodyStr);
    if (!undecided || !first.transportOk) return first;

    if (!this.#looksLikeEncodingFailure(first)) {
      if (first.status === 'accepted' || first.status === 'unknown') this.encodingConfirmed = true;
      return first;
    }
    // 거부/빈 결과는 부작용이 없었다는 뜻이므로, 다른 인코딩으로 딱 1번만 다시 시도한다.
    const alt = mode === 'raw' ? 'base64' : 'raw';
    const second = await this.#invoke(command, bodyStr, alt, timeoutSec);
    if (second.transportOk && !this.#looksLikeEncodingFailure(second)) {
      this.preferredEncoding = alt;
      this.encodingConfirmed = true;
      this.log(`한글 본문 인코딩을 '${mode}' → '${alt}' 로 전환했습니다.`);
      second.encodingFallback = { from: mode, to: alt };
      return second;
    }
    return first;
  }

  #looksLikeEncodingFailure(res) {
    if (res.status === 'invalid_body') return true;
    if (res.status === 'rejected' && res.errorCode === 'not_found') return true;
    return isEmptyResult(res.body);
  }

  #buildInvocation(command, bodyStr, mode) {
    const bodyArg = mode === 'none' ? null : mode === 'base64' ? `base64:${Buffer.from(bodyStr, 'utf8').toString('base64')}` : bodyStr;

    if (this.config.transport === 'ssh') {
      const host = this.config.sshHost;
      if (!SSH_HOST_RE.test(host)) return { error: `MABI_SSH_HOST 값이 올바르지 않습니다: "${host}"` };
      const exe = this.config.sshCliPath;
      const exeToken = /\s/.test(exe) ? `"${exe}"` : exe; // 공백 없는 경로는 cmd/PowerShell 양쪽에서 그대로 실행된다
      const remote = [exeToken, command, bodyArg].filter((x) => x !== null && x !== '').join(' ');
      const extra = this.config.sshOptions ? this.config.sshOptions.split(/\s+/).filter(Boolean) : [];
      return { file: 'ssh', args: [...extra, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remote] };
    }

    const exe = this.resolveCliPath();
    const args = bodyArg === null ? [command] : [command, bodyArg];
    if (SCRIPT_EXT_RE.test(exe)) return { file: process.execPath, args: [path.resolve(exe), ...args] }; // 모의 CLI(테스트용)
    return { file: exe, args };
  }

  async #invoke(command, bodyStr, mode, timeoutSec) {
    const started = Date.now();
    this.callCount += 1;
    const inv = this.#buildInvocation(command, bodyStr, mode);
    let result;
    if (inv.error) {
      result = this.#wrapperError('invalid_config', inv.error);
    } else {
      const out = await this.#exec(inv.file, inv.args, timeoutSec);
      result = this.#interpret(out, timeoutSec);
    }
    result.encoding = mode;
    result.durationMs = Date.now() - started;
    this.#audit(command, bodyStr, result);
    return result;
  }

  #exec(file, args, timeoutSec) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        resolve({ spawnError: err });
        return;
      }
      const out = [];
      const errChunks = [];
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch { /* 이미 종료됨 */ }
      }, Math.max(1, timeoutSec) * 1000);
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };
      child.stdout.on('data', (c) => out.push(c));
      child.stderr.on('data', (c) => errChunks.push(c));
      child.on('error', (err) => finish({ spawnError: err }));
      child.on('close', (code) =>
        finish({
          code,
          timedOut,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
        }),
      );
    });
  }

  #interpret(out, timeoutSec) {
    if (out.spawnError) {
      const code = out.spawnError.code === 'ENOENT' ? 'cli_not_found' : 'spawn_failed';
      const where = this.config.transport === 'ssh' ? 'ssh' : this.resolveCliPath();
      let message = `${where} 실행 실패: ${out.spawnError.message}`;
      if (code === 'cli_not_found' && process.platform === 'darwin' && this.config.transport === 'local') {
        message += ' — macOS 에서는 게임 CLI 를 직접 실행할 수 없습니다. 게임이 설치된 Windows PC 에서 이 프로젝트를 사용하세요(README 참고).';
      }
      return this.#wrapperError(code, message);
    }
    if (out.timedOut) {
      return this.#wrapperError('timeout', `CLI 가 ${timeoutSec}초 안에 응답하지 않아 래퍼가 대기를 중단했습니다. 게임 안의 동작은 계속 중일 수 있으니 get_activity 로 확인하세요.`);
    }
    const stdout = (out.stdout || '').replace(/^﻿/, '').trim();
    if (!stdout) {
      return this.#wrapperError('empty_response', (out.stderr || '').trim() || `CLI 가 출력 없이 종료했습니다(exit ${out.code}).`);
    }
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      const res = this.#wrapperError('invalid_json', 'CLI 출력이 JSON 이 아닙니다.');
      res.raw = stdout.slice(0, 2000);
      return res;
    }
    const { status, body } = normalizeResponse(parsed);
    return { transportOk: true, status, body, errorCode: errorCodeOf(body), exitCode: out.code };
  }

  #wrapperError(code, message) {
    return { transportOk: false, status: 'transport_error', body: { error: code, message }, errorCode: code };
  }

  #audit(command, bodyStr, result) {
    if (!this.config.logEnabled) return;
    try {
      fs.mkdirSync(this.config.logDir, { recursive: true });
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const entry = {
        ts: now.toISOString(),
        command,
        body: bodyStr || undefined,
        encoding: result.encoding,
        status: result.status,
        error: result.errorCode,
        result: result.body && typeof result.body === 'object' && !Array.isArray(result.body) ? result.body.result : undefined,
        ms: result.durationMs,
      };
      fs.appendFileSync(path.join(this.config.logDir, `mabi-${day}.jsonl`), `${JSON.stringify(entry)}\n`);
    } catch {
      /* 로그 실패로 게임 작업이 막히면 안 된다 */
    }
  }
}
