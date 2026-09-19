// 보호 장치: 정령의 날개 예산(세션·하루)·하한, 채팅 도배 방지.
// 프롬프트(지침)만으로는 실수를 100% 막을 수 없으므로, 돈이 나가는 부분은 코드로 한 번 더 막는다.
// 에이전트는 이 값을 바꿀 수 없다. 사용자가 .mcp.json 의 env 를 고치고 서버를 재시작해야 바뀐다.
import fs from 'node:fs';
import path from 'node:path';
import { clock } from './homework.mjs';

/** 하루(06:00 KST 기준) 지출 장부. 세션을 새로 열어도 유지된다. */
export class WingsLedger {
  constructor({ dir, now = () => Date.now(), reset = { hour: 6, weeklyDay: 1, utcOffsetHours: 9 } }) {
    this.file = path.join(dir, 'wings-ledger.json');
    this.now = now;
    this.reset = reset;
  }

  dayKey() {
    return clock(this.now(), this.reset).dailyKey;
  }

  #load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { days: {} }; }
  }

  today() {
    const day = this.#load().days?.[this.dayKey()];
    return { spent: day?.spent ?? 0, activities: day?.activities ?? 0 };
  }

  add(amount) {
    if (!(amount > 0)) return;
    try {
      const data = this.#load();
      data.days ??= {};
      const key = this.dayKey();
      const day = data.days[key] ?? { spent: 0, activities: 0 };
      day.spent += amount;
      day.activities += 1;
      data.days[key] = day;
      for (const k of Object.keys(data.days).sort().slice(0, -14)) delete data.days[k]; // 최근 14일만 보관
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, `${JSON.stringify(data, null, 2)}\n`);
    } catch {
      /* 장부를 못 써도 게임 작업은 막지 않는다(세션 예산이 여전히 보호한다) */
    }
  }
}

export class WingsGuard {
  constructor(config, ledger = null) {
    this.config = config;
    this.ledger = ledger;
    this.spent = 0; // 이 서버 세션에서 빠져나간 것으로 집계한 정령의 날개
    this.activities = 0;
    this.lastBalance = null;
  }

  summary() {
    const out = {
      perCall: this.config.wingsCostPerActivity,
      session: `${this.spent}/${this.config.wingsSessionBudget}`,
      reserve: this.config.wingsReserve,
      balance: this.lastBalance,
    };
    if (this.ledger && this.config.wingsDailyBudget > 0) out.today = `${this.ledger.today().spent}/${this.config.wingsDailyBudget}`;
    return out;
  }

  /** @param {number|null} balance 현재 잔액(조회 실패 시 null → 잔액 검사는 게임의 not_enough_currency 에 맡긴다) */
  precheck(balance) {
    const cost = this.config.wingsCostPerActivity;
    if (balance !== null) this.lastBalance = balance;
    if (this.spent + cost > this.config.wingsSessionBudget) {
      return { ok: false, code: 'budget_exceeded', message: `세션 예산 ${this.config.wingsSessionBudget}개 중 ${this.spent}개 사용. 이번 활동(${cost}개)을 실행하면 예산을 넘습니다.` };
    }
    if (this.ledger && this.config.wingsDailyBudget > 0) {
      const today = this.ledger.today().spent;
      if (today + cost > this.config.wingsDailyBudget) {
        return { ok: false, code: 'daily_budget_exceeded', message: `오늘(06시 기준) AI 가 쓴 정령의 날개 ${today}개 / 하루 상한 ${this.config.wingsDailyBudget}개. 이번 활동(${cost}개)을 실행하면 상한을 넘습니다.` };
      }
    }
    if (balance !== null && balance < cost) {
      return { ok: false, code: 'not_enough_currency', message: `${this.config.wingsName} 잔액 ${balance}개 — 활동 1회에 ${cost}개가 필요합니다.` };
    }
    if (balance !== null && balance - cost < this.config.wingsReserve) {
      return { ok: false, code: 'reserve_protected', message: `잔액 ${balance}개에서 ${cost}개를 쓰면 보호 하한 ${this.config.wingsReserve}개 아래로 내려갑니다.` };
    }
    return { ok: true };
  }

  /**
   * 실행 전후 잔액 차이로 지출을 기록한다.
   * - 비용 활동이 "시작됨"이면, 측정값이 더 작더라도 최소 1회 비용은 쓴 것으로 센다(도중에 날개를 얻은 경우 등 → 보수적으로).
   * - 비용 표기가 없는 활동(assumeCost=false)은 측정된 차이만 센다.
   */
  settle({ before, after, started, assumeCost = true }) {
    const delta = before !== null && after !== null ? before - after : null;
    let counted;
    if (started && assumeCost) counted = Math.max(delta ?? 0, this.config.wingsCostPerActivity);
    else counted = Math.max(0, delta ?? 0);
    if (counted > 0) this.activities += 1;
    this.spent += counted;
    if (counted > 0 && this.ledger) this.ledger.add(counted);
    if (after !== null) this.lastBalance = after;
    return { spent: counted, measured: delta !== null, balanceAfter: after };
  }
}

export class ChatGuard {
  constructor(config) {
    this.config = config;
    this.lastSentAt = 0;
    this.blockedUntil = 0;
    this.sentCount = 0;
  }

  precheck(now = Date.now()) {
    const nextAllowed = Math.max(this.blockedUntil, this.lastSentAt ? this.lastSentAt + this.config.chatMinIntervalSec * 1000 : 0);
    if (now < nextAllowed) {
      return { ok: false, retryAfterSeconds: Math.ceil((nextAllowed - now) / 1000) };
    }
    return { ok: true };
  }

  recordSent(now = Date.now()) {
    this.lastSentAt = now;
    this.sentCount += 1;
  }

  recordRateLimited(retryAfterSeconds, now = Date.now()) {
    const sec = Number(retryAfterSeconds);
    if (Number.isFinite(sec) && sec > 0) this.blockedUntil = Math.max(this.blockedUntil, now + sec * 1000);
  }
}
