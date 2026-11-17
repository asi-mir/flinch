'use strict';
// Turns one decoded SmartSpectra Metrics packet into flat samples.
// Every sample is { kind, t, v, ... } where t is the SDK frame time in ms.

const EXPRESSION_NAMES = {
  1: 'angry',
  2: 'contempt',
  3: 'disgust',
  4: 'fear',
  5: 'happy',
  6: 'neutral',
  7: 'sad',
  8: 'surprise',
};

function toMs(ts) {
  if (ts == null) return null;
  const us = typeof ts === 'object' && typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts);
  return Number.isFinite(us) ? us / 1000 : null;
}

function push(out, kind, t, fields) {
  if (t == null) return;
  out.push({ kind, t, ...fields });
}

function normalizeMetrics(metrics) {
  const out = [];
  if (!metrics) return out;
  const { cardio, breathing, face } = metrics;

  for (const m of cardio?.pulseRate || []) {
    push(out, 'pulse', toMs(m.timestamp), { v: m.value, conf: m.confidence ?? null, stable: !!m.stable });
  }
  for (const m of cardio?.arterialPressureTrace || []) {
    push(out, 'pulseTrace', toMs(m.timestamp), { v: m.value, stable: !!m.stable });
  }
  for (const m of cardio?.hrv || []) {
    push(out, 'hrv', toMs(m.timestamp), {
      v: m.rmssd,
      sdnn: m.sdnn,
      baevsky: m.baevsky,
      conf: m.confidence ?? null,
      stable: !!m.stable,
    });
  }
  for (const m of breathing?.rate || []) {
    push(out, 'breath', toMs(m.timestamp), { v: m.value, conf: m.confidence ?? null, stable: !!m.stable });
  }
  for (const m of breathing?.upperTrace || []) {
    push(out, 'breathTrace', toMs(m.timestamp), { v: m.value, stable: !!m.stable });
  }
  for (const m of face?.blinking || []) {
    push(out, 'blink', toMs(m.timestamp), { v: m.detected ? 1 : 0 });
  }
  for (const m of face?.talking || []) {
    push(out, 'talk', toMs(m.timestamp), { v: m.detected ? 1 : 0 });
  }
  for (const m of face?.expression || []) {
    const scores = {};
    let max = 0;
    for (const s of m.scores || []) {
      const name = EXPRESSION_NAMES[s.type];
      if (!name) continue;
      scores[name] = s.confidence ?? 0;
      if (scores[name] > max) max = scores[name];
    }
    // Scores may arrive as 0..1 or 0..100. Store 0..1.
    if (max > 1.5) for (const k of Object.keys(scores)) scores[k] /= 100;
    push(out, 'expr', toMs(m.timestamp), { v: scores });
  }
  return out;
}

module.exports = { normalizeMetrics, EXPRESSION_NAMES };
