import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- In-memory fake Redis (only the methods send-guard uses) ---
class FakeRedis {
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  failNext = false; // when true, the next op throws (simulates Redis down)

  private guard() {
    if (this.failNext) { this.failNext = false; throw new Error('redis down'); }
  }
  async get(k: string) { this.guard(); return this.store.get(k) ?? null; }
  async set(k: string, v: string) { this.guard(); this.store.set(k, v); return 'OK'; }
  async incr(k: string) {
    this.guard();
    const n = (parseInt(this.store.get(k) ?? '0', 10) || 0) + 1;
    this.store.set(k, String(n));
    return n;
  }
  async expire() { this.guard(); return 1; }
  async sismember(k: string, m: string) { this.guard(); return this.sets.get(k)?.has(m) ? 1 : 0; }
  async sadd(k: string, ...m: string[]) {
    this.guard();
    const s = this.sets.get(k) ?? new Set<string>();
    m.forEach(x => s.add(x));
    this.sets.set(k, s);
    return m.length;
  }
}

let fake: FakeRedis;
const sendMock = vi.fn(async (..._args: unknown[]) => ({ success: true }));
let sentinelExists = false;

vi.mock('../integrations/redis-client', () => ({ getRedis: () => fake }));
vi.mock('@justice/messaging', () => ({ sendIMessage: (...a: unknown[]) => sendMock(...a) }));
vi.mock('fs', () => ({ existsSync: () => sentinelExists }));

import { sendGuardedIMessage } from './send-guard';

const PHONE = '+15555550123';

beforeEach(() => {
  fake = new FakeRedis();
  sendMock.mockClear();
  sentinelExists = false;
  delete process.env.JUSTICE_OUTBOUND_PAUSE;
  delete process.env.JUSTICE_OUTBOUND_TOPIC_MAX;
  delete process.env.JUSTICE_OUTBOUND_DAILY_MAX;
});

describe('sendGuardedIMessage', () => {
  it('sends a normal message', async () => {
    const r = await sendGuardedIMessage(PHONE, 'hello', 'morning_brief');
    expect(r.sent).toBe(true);
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('suppresses an identical body the second time (content dedup)', async () => {
    await sendGuardedIMessage(PHONE, 'same body', 'agent_notification');
    const r = await sendGuardedIMessage(PHONE, 'same body', 'agent_notification');
    expect(r).toEqual({ sent: false, reason: 'duplicate' });
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('caps a meaningful kind at 1/day by default (topic cap)', async () => {
    const a = await sendGuardedIMessage(PHONE, 'brief A', 'morning_brief');
    const b = await sendGuardedIMessage(PHONE, 'brief B', 'morning_brief');
    expect(a.sent).toBe(true);
    expect(b).toEqual({ sent: false, reason: 'topic-cap' });
  });

  it('honors an explicit topic key across different kinds', async () => {
    await sendGuardedIMessage(PHONE, 'about bead-7 #1', 'k1', { topic: 'bead-7' });
    const r = await sendGuardedIMessage(PHONE, 'about bead-7 #2', 'k2', { topic: 'bead-7' });
    expect(r).toEqual({ sent: false, reason: 'topic-cap' });
  });

  it('respects topicMax override (task_nudge gets 2/day)', async () => {
    const a = await sendGuardedIMessage(PHONE, 'nudge 1', 'task_nudge', { topicMax: 2 });
    const b = await sendGuardedIMessage(PHONE, 'nudge 2', 'task_nudge', { topicMax: 2 });
    const c = await sendGuardedIMessage(PHONE, 'nudge 3', 'task_nudge', { topicMax: 2 });
    expect(a.sent).toBe(true);
    expect(b.sent).toBe(true);
    expect(c).toEqual({ sent: false, reason: 'topic-cap' });
  });

  it('does NOT topic-cap generic agent_notification (different bodies still send)', async () => {
    const a = await sendGuardedIMessage(PHONE, 'progress 1', 'agent_notification');
    const b = await sendGuardedIMessage(PHONE, 'progress 2', 'agent_notification');
    expect(a.sent).toBe(true);
    expect(b.sent).toBe(true);
  });

  it('blocks when paused via env flag', async () => {
    process.env.JUSTICE_OUTBOUND_PAUSE = 'true';
    const r = await sendGuardedIMessage(PHONE, 'x', 'morning_brief');
    expect(r).toEqual({ sent: false, reason: 'paused' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('blocks when paused via sentinel file', async () => {
    sentinelExists = true;
    const r = await sendGuardedIMessage(PHONE, 'x', 'morning_brief');
    expect(r).toEqual({ sent: false, reason: 'paused' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fails closed when Redis is unavailable on the dedup check', async () => {
    fake.failNext = true;
    const r = await sendGuardedIMessage(PHONE, 'x', 'morning_brief');
    expect(r).toEqual({ sent: false, reason: 'redis-unavailable' });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('enforces the global daily cap regardless of distinct topics', async () => {
    process.env.JUSTICE_OUTBOUND_DAILY_MAX = '3';
    const results = [];
    for (let i = 0; i < 6; i++) {
      // distinct topic + body each time so only the GLOBAL cap can stop them
      results.push(await sendGuardedIMessage(PHONE, `msg ${i}`, `kind${i}`, { topic: `t${i}` }));
    }
    const sentCount = results.filter(r => r.sent).length;
    expect(sentCount).toBe(3);
    // the 4th crosses the cap and emits exactly one terminal notice
    expect(results[4].reason).toBe('cap-exceeded');
  });
});
