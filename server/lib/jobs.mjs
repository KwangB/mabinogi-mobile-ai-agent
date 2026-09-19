// 오래 걸리는 활동(채집 100개 ≈ 2~15분)을 "작업(job)"으로 관리한다.
// 도구 호출은 maxWaitSec 까지만 기다리고, 그 안에 안 끝나면 job 핸들을 돌려준다 → 클라이언트 타임아웃과 무관하게 안전.
// 동시에 하나의 활동만 허용한다(게임은 새 활동이 오면 이전 활동을 canceled 처리하기 때문).

let seq = 0;

export class JobManager {
  constructor() {
    this.active = null;
    this.history = [];
  }

  isBusy() {
    return Boolean(this.active && this.active.state === 'running');
  }

  start(kind, label, runFn) {
    if (this.isBusy()) throw new Error('busy');
    seq += 1;
    const job = {
      id: `job-${Date.now().toString(36)}-${seq}`,
      kind,
      label,
      state: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
    };
    job.promise = Promise.resolve()
      .then(() => runFn(job))
      .then(
        (result) => { job.result = result; },
        (err) => { job.result = { ok: false, error: 'internal_error', message: String(err?.message || err) }; },
      )
      .finally(() => {
        job.state = 'done';
        job.finishedAt = Date.now();
        this.history.unshift(job);
        this.history = this.history.slice(0, 10);
        if (this.active === job) this.active = null;
      });
    this.active = job;
    return job;
  }

  find(jobId) {
    if (!jobId) return this.active || this.history[0] || null;
    if (this.active && this.active.id === jobId) return this.active;
    return this.history.find((j) => j.id === jobId) || null;
  }

  /** waitSec 동안 완료를 기다린다. onTick 은 진행 알림용(초 단위 경과). */
  async wait(job, waitSec, { onTick, signal } = {}) {
    if (job.state === 'done') return true;
    const deadline = Date.now() + waitSec * 1000;
    let done = false;
    job.promise.then(() => { done = true; });
    while (!done && Date.now() < deadline) {
      if (signal?.aborted) return false;
      await Promise.race([job.promise, new Promise((r) => setTimeout(r, 1000))]);
      if (!done && onTick) onTick(Math.round((Date.now() - job.startedAt) / 1000));
    }
    return done || job.state === 'done';
  }

  view(job) {
    if (!job) return null;
    const end = job.finishedAt ?? Date.now();
    return { id: job.id, kind: job.kind, label: job.label, state: job.state, elapsedSec: Math.round((end - job.startedAt) / 1000) };
  }
}
