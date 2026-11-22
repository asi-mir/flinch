'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectMoments } = require('../src/core/detector');
const { normalizeMetrics } = require('../src/core/normalize');

// A calm 30 s baseline, then a 90 s task.
function calmSession() {
  const samples = { pulse: [], breath: [], breathTrace: [], blink: [], expr: [], hrv: [] };
  const end = 120000;
  for (let t = 0; t <= end; t += 1000) {
    samples.pulse.push({ t, v: 68 + Math.sin(t / 7000), stable: true });
    samples.breath.push({ t, v: 14, stable: true });
  }
  for (let t = 0; t <= end; t += 100) {
    samples.breathTrace.push({ t, v: Math.sin((t / 1000) * 2 * Math.PI * (14 / 60)), stable: true });
    // One blink every 4 s (15 per minute), 200 ms long.
    samples.blink.push({ t, v: t % 4000 < 200 ? 1 : 0 });
    samples.expr.push({ t, v: { neutral: 0.9, happy: 0.05, angry: 0.02 } });
  }
  return { samples, events: [], invalid: [], baseline: { start: 0, end: 30000 }, test: { start: 30000, end } };
}

test('a calm session has no moments', () => {
  const { moments, summary } = detectMoments(calmSession());
  assert.deepStrictEqual(moments, []);
  assert.strictEqual(summary.measuredPct, 100);
  assert.ok(Math.abs(summary.pulse.baseline - 68) < 1.5);
});

test('a pulse rise is reported with its lag window', () => {
  const s = calmSession();
  for (const p of s.samples.pulse) if (p.t >= 70000 && p.t <= 85000) p.v += 10;
  const { moments } = detectMoments(s);
  assert.strictEqual(moments.length, 1);
  const [m] = moments;
  assert.strictEqual(m.signals[0].kind, 'pulse');
  assert.match(m.signals[0].label, /Pulse \+\d+ bpm/);
  assert.strictEqual(m.strength, 'single');
  // The window reaches back 12 s before the rise was seen.
  assert.ok(m.window.start <= 60000 && m.window.end >= 70000);
});

test('face and pulse together make one strong moment with its events', () => {
  const s = calmSession();
  for (const p of s.samples.pulse) if (p.t >= 66000 && p.t <= 80000) p.v += 9;
  for (const e of s.samples.expr) if (e.t >= 60000 && e.t <= 62500) e.v = { neutral: 0.2, angry: 0.7 };
  s.events.push({ t: 59500, type: 'click', text: 'Pay now', url: 'https://shop.test/checkout' });
  s.events.push({ t: 10000, type: 'click', text: 'unrelated' });
  const { moments } = detectMoments(s);
  assert.strictEqual(moments.length, 1);
  const [m] = moments;
  assert.strictEqual(m.strength, 'strong');
  assert.deepStrictEqual(m.signals.map((x) => x.kind).sort(), ['expression', 'pulse']);
  assert.ok(Math.abs(m.t - 60000) < 1500, 'time comes from the fast signal');
  assert.strictEqual(m.events.length, 1);
  assert.strictEqual(m.events[0].text, 'Pay now');
  assert.strictEqual(m.url, 'https://shop.test/checkout');
});

test('a sad face counts, but not while typing', () => {
  const s = calmSession();
  for (const e of s.samples.expr) {
    if ((e.t >= 50000 && e.t <= 53000) || (e.t >= 80000 && e.t <= 83000)) e.v = { neutral: 0.1, sad: 0.9 };
  }
  for (let t = 79000; t <= 84000; t += 1000) s.events.push({ t, type: 'typing', text: 'Email' });
  const sad = detectMoments(s).moments.flatMap((m) => m.signals).filter((x) => x.label.startsWith('Face: sad'));
  assert.strictEqual(sad.length, 1);
  assert.ok(sad[0].onset >= 50000 && sad[0].onset < 53000);
});

test('a happy face is a positive moment of its own', () => {
  const s = calmSession();
  for (const e of s.samples.expr) {
    if (e.t >= 60000 && e.t <= 62000) e.v = { neutral: 0.1, angry: 0.9 };
    if (e.t >= 64000 && e.t <= 67000) e.v = { neutral: 0.1, happy: 0.9 };
  }
  const { moments } = detectMoments(s);
  const tones = moments.map((m) => m.tone).sort();
  assert.deepStrictEqual(tones, ['negative', 'positive']);
  assert.match(moments.find((m) => m.tone === 'positive').signals[0].label, /^Face: happy/);
});

test('a face reaction counts when only the chest is out of view', () => {
  const s = calmSession();
  for (const e of s.samples.expr) if (e.t >= 70000 && e.t <= 73000) e.v = { neutral: 0.05, fear: 0.95 };
  s.invalid.push({ start: 69000, end: 75000, reason: 'Place more of the chest in view.' });
  const face = detectMoments(s).moments.flatMap((m) => m.signals).filter((x) => x.kind === 'expression');
  assert.strictEqual(face.length, 1);
  assert.match(face[0].label, /^Face: fear/);
});

test('a face that stays negative does not start a second hit later', () => {
  const s = calmSession();
  // Angry from 60 s to 61.5 s, a dip, then angry again from 62 s to 75 s without a break
  // after the quiet period ends. Only the two real rises count, not a late restart.
  for (const e of s.samples.expr) {
    if ((e.t >= 60000 && e.t <= 61500) || (e.t >= 63000 && e.t <= 75000)) e.v = { neutral: 0.1, angry: 0.9 };
  }
  const onsets = detectMoments(s)
    .moments.flatMap((m) => m.signals)
    .filter((x) => x.kind === 'expression')
    .map((x) => x.onset);
  assert.strictEqual(onsets.length, 1);
  assert.ok(onsets[0] >= 60000 && onsets[0] < 61500);
});

test('a breath hold is found', () => {
  const s = calmSession();
  for (const b of s.samples.breathTrace) if (b.t >= 50000 && b.t <= 58000) b.v = 0.01;
  const { moments } = detectMoments(s);
  assert.strictEqual(moments.length, 1);
  assert.strictEqual(moments[0].signals[0].kind, 'breathHold');
});

test('a stare (few blinks) is found', () => {
  const s = calmSession();
  for (const b of s.samples.blink) if (b.t >= 60000 && b.t <= 90000) b.v = 0;
  const { moments } = detectMoments(s);
  assert.strictEqual(moments.length, 1);
  assert.match(moments[0].signals[0].label, /stare/);
});

test('reactions during a bad-measurement period are ignored', () => {
  const s = calmSession();
  for (const p of s.samples.pulse) if (p.t >= 70000 && p.t <= 85000) p.v += 25;
  for (const e of s.samples.expr) if (e.t >= 70000 && e.t <= 73000) e.v = { angry: 0.9 };
  s.invalid.push({ start: 68000, end: 87000, reason: 'Too much movement' });
  const { moments, summary } = detectMoments(s);
  assert.deepStrictEqual(moments, []);
  assert.ok(summary.measuredPct < 100);
});

test('unstable pulse samples are not trusted', () => {
  const s = calmSession();
  for (const p of s.samples.pulse) {
    if (p.t >= 70000 && p.t <= 85000) {
      p.v += 20;
      p.stable = false;
    }
  }
  assert.deepStrictEqual(detectMoments(s).moments, []);
});

test('normalizeMetrics flattens a packet and scales expression scores', () => {
  const samples = normalizeMetrics({
    cardio: { pulseRate: [{ value: 71, confidence: 80, stable: true, timestamp: 2000000 }] },
    breathing: { upperTrace: [{ value: 0.4, stable: true, timestamp: { toNumber: () => 2100000 } }] },
    face: {
      blinking: [{ detected: true, timestamp: 2200000 }],
      expression: [{ timestamp: 2300000, scores: [{ type: 1, confidence: 60 }, { type: 6, confidence: 30 }] }],
    },
  });
  assert.deepStrictEqual(samples.map((s) => s.kind), ['pulse', 'breathTrace', 'blink', 'expr']);
  assert.strictEqual(samples[0].t, 2000);
  assert.strictEqual(samples[1].t, 2100);
  assert.deepStrictEqual(samples[3].v, { angry: 0.6, neutral: 0.3 });
});

test('a short sad flicker is not a moment, a surprise is', () => {
  const s = calmSession();
  for (const e of s.samples.expr) {
    if (e.t >= 50000 && e.t <= 51000) e.v = { neutral: 0.1, sad: 0.9 };
    if (e.t >= 70000 && e.t <= 72500) e.v = { neutral: 0.01, surprise: 0.99 };
  }
  const labels = detectMoments(s).moments.flatMap((m) => m.signals).map((x) => x.label);
  assert.ok(!labels.some((l) => l.startsWith('Face: sad')));
  assert.ok(labels.some((l) => l.startsWith('Face: surprise')));
});

test('a slow breathing change does not join two separate face reactions', () => {
  const s = calmSession();
  for (const e of s.samples.expr) {
    if (e.t >= 60000 && e.t <= 62000) e.v = { neutral: 0.1, angry: 0.9 };
    if (e.t >= 75000 && e.t <= 77000) e.v = { neutral: 0.01, surprise: 0.99 };
  }
  // Breathing rate rises at 80 s; its 30 s window covers both face reactions.
  for (const b of s.samples.breath) if (b.t >= 80000 && b.t <= 90000) b.v = 22;
  const { moments } = detectMoments(s);
  const face = moments.filter((m) => m.signals.some((x) => x.kind === 'expression'));
  assert.strictEqual(face.length, 2);
  const withBreath = moments.find((m) => m.signals.some((x) => x.kind === 'breathRate'));
  assert.ok(withBreath.signals.some((x) => x.label.startsWith('Face: surprise')));
});

test('events after a face reaction are not listed as its cause', () => {
  const s = calmSession();
  for (const e of s.samples.expr) if (e.t >= 60000 && e.t <= 62000) e.v = { neutral: 0.1, sad: 0.9 };
  for (const p of s.samples.pulse) if (p.t >= 70000 && p.t <= 85000) p.v += 15;
  s.events.push({ t: 59000, type: 'click', text: 'Close' }, { t: 75000, type: 'typing', text: 'Email' });
  const m = detectMoments(s).moments.find((x) => x.signals.some((y) => y.kind === 'expression'));
  assert.ok(m.signals.some((y) => y.kind === 'pulse'));
  assert.deepStrictEqual(m.events.map((e) => e.text), ['Close']);
});
