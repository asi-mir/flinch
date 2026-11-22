'use strict';
// Finds "reaction moments" in a recorded session.
//
// Input times are ms from the start of the session. The detector is plain
// arithmetic on purpose: every moment it reports can be checked by hand
// against the numbers stored in the session file.
//
// A body reaction is a hint that something on screen deserves a look. It is
// not a measurement of emotion and it is not proof of a usability problem.

const DEFAULTS = {
  // Pulse rate is a 12 s average, so a rise shows up late.
  pulseLagMs: 12000,
  pulseRiseBpm: 6,
  pulseRefFromMs: 30000, // compare with the median of [t-30s, t-10s]
  pulseRefToMs: 10000,
  pulseMinRefSamples: 3,
  // Breathing rate is a 30 s average.
  breathLagMs: 30000,
  breathRiseBpm: 4,
  // Expressions are per frame.
  exprLagMs: 3000,
  exprSmoothMs: 1000,
  exprMinLevel: 0.35,
  exprRiseOverBaseline: 0.25,
  exprMinDurationMs: 700,
  // Blink rate over a sliding window.
  blinkWindowMs: 10000,
  blinkMinBaselinePerMin: 6,
  blinkStareRatio: 0.4,
  blinkFlurryRatio: 2.2,
  blinkFlurryMinCount: 5,
  // Breath hold: the chest trace goes flat.
  holdWindowMs: 5000,
  holdAmplitudeRatio: 0.2,
  holdMinDurationMs: 4000,
  // Samples near a bad-measurement period are ignored.
  invalidPadMs: 1500,
  // Hits closer than this join into one moment.
  mergeGapMs: 6000,
  // A new hit of the same kind needs this much quiet first.
  refractoryMs: 8000,
  // Expressions that count as a negative reaction.
  exprNegative: ['angry', 'contempt', 'disgust', 'fear'],
  // "Sad" is checked on its own. The model reads a face looking down at the
  // keyboard as sad, so sad is ignored from 1 s before to 3 s after typing or
  // clicking into a form field.
  exprSad: ['sad'],
  exprSadSkipBeforeMs: 1000,
  exprSadSkipAfterMs: 3000,
  // Sad is the noisiest expression, so it must last longer.
  exprSadMinDurationMs: 1500,
  // Surprise is checked on its own: it can be good or bad, but it shows that
  // something on screen was not expected.
  exprSurprise: ['surprise'],
  // Expressions that count as a positive reaction.
  exprPositive: ['happy'],
};
const WEIGHTS = { pulse: 2, expression: 2, breathHold: 1.5, blink: 1, breathRate: 1 };

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function inAny(intervals, t, pad) {
  for (const iv of intervals) if (t >= iv.start - pad && t <= iv.end + pad) return true;
  return false;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Keeps only trustworthy samples inside [from, to].
function usable(samples, from, to, invalid, pad, needStable) {
  return (samples || []).filter(
    (s) => s.t >= from && s.t <= to && (!needStable || s.stable) && !inAny(invalid, s.t, pad),
  );
}

// Detects a rise of a slow "rate" signal against its own recent past.
function detectRise(series, opts) {
  const { rise, refFromMs, refToMs, minRef, refractoryMs } = opts;
  const hits = [];
  let open = null;
  let lastEnd = -Infinity;
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const ref = [];
    for (let j = i - 1; j >= 0; j--) {
      const age = s.t - series[j].t;
      if (age > refFromMs) break;
      if (age >= refToMs) ref.push(series[j].v);
    }
    const base = ref.length >= minRef ? median(ref) : null;
    const delta = base == null ? 0 : s.v - base;
    if (delta >= rise) {
      if (!open && s.t - lastEnd >= refractoryMs) open = { onset: s.t, end: s.t, base, peak: s.v, delta };
      if (open) {
        open.end = s.t;
        if (delta > open.delta) {
          open.delta = delta;
          open.peak = s.v;
        }
      }
    } else if (open) {
      hits.push(open);
      lastEnd = open.end;
      open = null;
    }
  }
  if (open) hits.push(open);
  return hits;
}

function detectPulse(session, cfg, invalid, from, to) {
  const series = usable(session.samples.pulse, 0, to, invalid, cfg.invalidPadMs, true);
  return detectRise(series, {
    rise: cfg.pulseRiseBpm,
    refFromMs: cfg.pulseRefFromMs,
    refToMs: cfg.pulseRefToMs,
    minRef: cfg.pulseMinRefSamples,
    refractoryMs: cfg.refractoryMs,
  })
    .filter((h) => h.onset >= from)
    .map((h) => ({
      kind: 'pulse',
      onset: h.onset,
      end: h.end,
      window: { start: Math.max(0, h.onset - cfg.pulseLagMs), end: h.onset },
      label: `Pulse +${Math.round(h.delta)} bpm`,
      detail: `Pulse rose from about ${Math.round(h.base)} to ${Math.round(h.peak)} bpm.`,
      delta: round1(h.delta),
    }));
}

function detectBreathRate(session, cfg, invalid, from, to) {
  const series = usable(session.samples.breath, 0, to, invalid, cfg.invalidPadMs, true);
  return detectRise(series, {
    rise: cfg.breathRiseBpm,
    refFromMs: 60000,
    refToMs: 20000,
    minRef: 3,
    refractoryMs: 20000,
  })
    .filter((h) => h.onset >= from)
    .map((h) => ({
      kind: 'breathRate',
      onset: h.onset,
      end: h.end,
      window: { start: Math.max(0, h.onset - cfg.breathLagMs), end: h.onset },
      label: `Breathing +${Math.round(h.delta)}/min`,
      detail: `Breathing rate rose from about ${Math.round(h.base)} to ${Math.round(h.peak)} per minute.`,
      delta: round1(h.delta),
    }));
}

function expressionLevel(scores, names) {
  let total = 0;
  let top = null;
  let topValue = 0;
  for (const name of names) {
    const v = scores[name] || 0;
    total += v;
    if (v > topValue) {
      topValue = v;
      top = name;
    }
  }
  return { total: Math.min(1, total), top };
}

// Times when the tester's eyes are probably on the keyboard: typing, or clicking
// into a form field.
function keyboardPeriods(events, cfg) {
  const fieldTags = new Set(['input', 'textarea', 'select', 'label']);
  return (events || [])
    .filter((e) => e.type === 'typing' || e.type === 'change' || (e.type === 'click' && fieldTags.has(e.tag)))
    .map((e) => ({ start: e.t - cfg.exprSadSkipBeforeMs, end: e.t + cfg.exprSadSkipAfterMs }));
}

// Expression scores need only the face, so a period when only the chest is out of
// view does not block them. Movement, light and other problems still do.
function faceInvalid(invalid) {
  return invalid.filter((iv) => !/chest/i.test(iv.reason || ''));
}

function detectExpression(session, cfg, invalid, from, to, baseline, spec) {
  const raw = usable(session.samples.expr, 0, to, faceInvalid(invalid), cfg.invalidPadMs, false);
  if (!raw.length) return [];
  const skip = spec.skip || [];
  const levels = raw.map((s) => (inAny(skip, s.t, 0) ? { t: s.t, total: 0, top: null } : { t: s.t, ...expressionLevel(s.v, spec.names) }));
  const baseLevels = levels.filter((l) => l.t >= baseline.start && l.t <= baseline.end).map((l) => l.total);
  const base = baseLevels.length ? mean(baseLevels) : 0;
  const threshold = Math.max(cfg.exprMinLevel, base + cfg.exprRiseOverBaseline);

  const hits = [];
  let open = null;
  let lastEnd = -Infinity;
  let head = 0;
  let sum = 0;
  let wasBelow = true;
  for (let i = 0; i < levels.length; i++) {
    sum += levels[i].total;
    while (levels[i].t - levels[head].t > cfg.exprSmoothMs) sum -= levels[head++].total;
    const smooth = sum / (i - head + 1);
    const t = levels[i].t;
    const crossing = wasBelow;
    wasBelow = smooth < threshold;
    if (smooth >= threshold) {
      // Start only where the level rises. A level that stays high through the quiet
      // period must not start a hit later, on whatever screen is showing by then.
      if (!open && crossing && t - lastEnd >= cfg.refractoryMs) open = { onset: t, end: t, peak: smooth, tops: {} };
      if (open) {
        open.end = t;
        open.peak = Math.max(open.peak, smooth);
        if (levels[i].top) open.tops[levels[i].top] = (open.tops[levels[i].top] || 0) + 1;
      }
    } else if (open) {
      hits.push(open);
      lastEnd = open.end;
      open = null;
    }
  }
  if (open) hits.push(open);

  return hits
    .filter((h) => h.onset >= from && h.end - h.onset >= (spec.minDurationMs ?? cfg.exprMinDurationMs))
    .map((h) => {
      const top = Object.entries(h.tops).sort((a, b) => b[1] - a[1])[0]?.[0] || 'negative';
      return {
        kind: 'expression',
        tone: spec.tone,
        onset: h.onset,
        end: h.end,
        window: { start: Math.max(0, h.onset - cfg.exprLagMs), end: h.onset },
        label: `Face: ${top} ${Math.round(h.peak * 100)}%`,
        detail: `The face read as "${top}" for ${round1((h.end - h.onset) / 1000)} s (usual level ${Math.round(base * 100)}%).`,
        delta: round1(h.peak - base),
      };
    });
}

// Blink samples are per frame (1 while the eyes are closed). A blink is a 0 -> 1 edge.
function blinkTimes(samples) {
  const times = [];
  let prev = 0;
  for (const s of samples) {
    if (s.v === 1 && prev === 0) times.push(s.t);
    prev = s.v;
  }
  return times;
}

function detectBlink(session, cfg, invalid, from, to, baseline) {
  const all = usable(session.samples.blink, 0, to, invalid, cfg.invalidPadMs, false);
  if (!all.length) return [];
  const blinks = blinkTimes(all);
  const baseSpan = baseline.end - baseline.start;
  if (baseSpan < cfg.blinkWindowMs) return [];
  const baseCount = blinks.filter((t) => t >= baseline.start && t <= baseline.end).length;
  const basePerMin = (baseCount / baseSpan) * 60000;
  if (basePerMin < cfg.blinkMinBaselinePerMin) return [];
  const expected = (basePerMin * cfg.blinkWindowMs) / 60000;

  const hits = [];
  const open = { stare: null, flurry: null };
  const lastEnd = { stare: -Infinity, flurry: -Infinity };
  const close = (type) => {
    if (!open[type]) return;
    hits.push(open[type]);
    lastEnd[type] = open[type].end;
    open[type] = null;
  };
  for (let t = from + cfg.blinkWindowMs; t <= to; t += 1000) {
    const winStart = t - cfg.blinkWindowMs;
    // Skip windows that touch a bad-measurement period: missing frames look like a stare.
    if (invalid.some((iv) => iv.end >= winStart && iv.start <= t)) {
      close('stare');
      close('flurry');
      continue;
    }
    const count = blinks.filter((b) => b > winStart && b <= t).length;
    const stare = count <= expected * cfg.blinkStareRatio;
    const flurry = count >= expected * cfg.blinkFlurryRatio && count >= cfg.blinkFlurryMinCount;
    for (const [type, on] of [['stare', stare], ['flurry', flurry]]) {
      if (on) {
        if (!open[type] && winStart - lastEnd[type] >= cfg.refractoryMs) {
          open[type] = { type, onset: winStart, end: t, count };
        }
        if (open[type]) {
          open[type].end = t;
          open[type].count = type === 'stare' ? Math.min(open[type].count, count) : Math.max(open[type].count, count);
        }
      } else close(type);
    }
  }
  close('stare');
  close('flurry');

  return hits.map((h) => {
    const perMin = Math.round((h.count / cfg.blinkWindowMs) * 60000);
    const stare = h.type === 'stare';
    return {
      kind: 'blink',
      onset: h.onset,
      end: h.end,
      window: { start: h.onset, end: h.end },
      label: stare ? `Blinks ${perMin}/min (stare)` : `Blinks ${perMin}/min (flurry)`,
      detail: stare
        ? `Blinking dropped to ${perMin} per minute from a usual ${Math.round(basePerMin)}. People blink less when they concentrate hard.`
        : `Blinking jumped to ${perMin} per minute from a usual ${Math.round(basePerMin)}.`,
      delta: round1(perMin - basePerMin),
    };
  });
}

function amplitudeIn(series, startIdx, endIdx) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = startIdx; i <= endIdx; i++) {
    if (series[i].v < lo) lo = series[i].v;
    if (series[i].v > hi) hi = series[i].v;
  }
  return hi - lo;
}

function detectBreathHold(session, cfg, invalid, from, to, baseline) {
  // The trace inherits its "stable" flag from the SDK's breathing-rate verdict.
  const series = usable(session.samples.breathTrace, 0, to, invalid, cfg.invalidPadMs, true);
  if (series.length < 20) return [];
  // Usual breath depth: median amplitude over 5 s windows in the baseline.
  const amps = [];
  let head = 0;
  const windows = [];
  for (let i = 0; i < series.length; i++) {
    while (series[i].t - series[head].t > cfg.holdWindowMs) head++;
    if (series[i].t - series[head].t < cfg.holdWindowMs * 0.8) continue;
    const amp = amplitudeIn(series, head, i);
    windows.push({ t: series[i].t, start: series[head].t, amp });
    if (series[i].t >= baseline.start && series[i].t <= baseline.end) amps.push(amp);
  }
  const usual = median(amps);
  if (!usual) return [];

  const hits = [];
  let open = null;
  let lastEnd = -Infinity;
  for (const w of windows) {
    if (w.t < from) continue;
    if (w.amp <= usual * cfg.holdAmplitudeRatio) {
      if (!open && w.start - lastEnd >= cfg.refractoryMs) open = { onset: w.start, end: w.t };
      if (open) open.end = w.t;
    } else if (open) {
      hits.push(open);
      lastEnd = open.end;
      open = null;
    }
  }
  if (open) hits.push(open);

  return hits
    .filter((h) => h.end - h.onset >= cfg.holdMinDurationMs)
    .map((h) => ({
      kind: 'breathHold',
      onset: h.onset,
      end: h.end,
      window: { start: Math.max(0, h.onset - 2000), end: h.onset },
      label: `Breath held ${Math.round((h.end - h.onset) / 1000)} s`,
      detail: `Chest movement went nearly flat for ${Math.round((h.end - h.onset) / 1000)} s.`,
      delta: round1((h.end - h.onset) / 1000),
    }));
}

const isFast = (h) => h.kind === 'expression' || h.kind === 'breathHold';

// The fast signal that best marks a moment: the biggest change.
function strongestFast(hits) {
  return hits.filter(isFast).sort((a, b) => b.delta - a.delta || a.onset - b.onset)[0] || null;
}

// Fast hits (face, held breath) join when they are close in time. A slow hit (pulse,
// breathing rate, blinking) points back over a long window, so it must not glue two
// separate fast reactions together: it joins the one fast group it overlaps that is
// nearest to its own onset. Slow hits with no fast group join each other.
function mergeHits(hits, cfg) {
  const groups = mergeWindows(hits.filter(isFast), cfg);
  const lonely = [];
  for (const hit of hits.filter((h) => !isFast(h))) {
    let best = null;
    let bestDistance = Infinity;
    for (const group of groups) {
      for (const f of group.hits) {
        if (!isFast(f)) continue;
        if (f.onset < hit.window.start - cfg.mergeGapMs || f.onset > hit.window.end + cfg.mergeGapMs) continue;
        const distance = Math.abs(hit.onset - f.onset);
        if (distance < bestDistance) {
          best = group;
          bestDistance = distance;
        }
      }
    }
    if (best) {
      best.hits.push(hit);
      best.start = Math.min(best.start, hit.window.start);
      best.end = Math.max(best.end, hit.window.end);
    } else lonely.push(hit);
  }
  return [...groups, ...mergeWindows(lonely, cfg)].sort((a, b) => a.start - b.start);
}

function mergeWindows(hits, cfg) {
  const sorted = [...hits].sort((a, b) => a.window.start - b.window.start);
  const groups = [];
  for (const hit of sorted) {
    const last = groups[groups.length - 1];
    if (last && hit.window.start <= last.end + cfg.mergeGapMs) {
      last.hits.push(hit);
      last.end = Math.max(last.end, hit.window.end);
    } else {
      groups.push({ start: hit.window.start, end: hit.window.end, hits: [hit] });
    }
  }
  return groups;
}

function summarise(session, invalid, from, to, baseline, cfg) {
  const stat = (kind, needStable) => {
    const base = usable(session.samples[kind], baseline.start, baseline.end, invalid, cfg.invalidPadMs, needStable).map((s) => s.v);
    const test = usable(session.samples[kind], from, to, invalid, cfg.invalidPadMs, needStable).map((s) => s.v);
    return {
      baseline: base.length ? round1(mean(base)) : null,
      test: test.length ? round1(mean(test)) : null,
      max: test.length ? round1(Math.max(...test)) : null,
      samples: test.length,
    };
  };
  const invalidMs = invalid.reduce((sum, iv) => sum + Math.max(0, Math.min(iv.end, to) - Math.max(iv.start, from)), 0);
  return {
    durationMs: to - from,
    measuredPct: to > from ? Math.round(100 * (1 - invalidMs / (to - from))) : 0,
    pulse: stat('pulse', true),
    breathing: stat('breath', true),
    hrvRmssd: stat('hrv', true),
  };
}

/**
 * @param {object} session
 *   samples: { pulse, breath, breathTrace, blink, expr, hrv } arrays of { t, v, stable? }
 *   events:  [{ t, type, ... }] things that happened in the tested page
 *   invalid: [{ start, end, reason }] periods when the measurement was not usable
 *   baseline: { start, end }  the calm period before the task
 *   test: { start, end }      the task itself
 */
function detectMoments(session, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const invalid = session.invalid || [];
  const baseline = session.baseline;
  const { start: from, end: to } = session.test;

  const hits = [
    ...detectPulse(session, cfg, invalid, from, to),
    ...detectExpression(session, cfg, invalid, from, to, baseline, { names: cfg.exprNegative, tone: 'negative' }),
    ...detectExpression(session, cfg, invalid, from, to, baseline, {
      names: cfg.exprSad,
      tone: 'negative',
      skip: keyboardPeriods(session.events, cfg),
      minDurationMs: cfg.exprSadMinDurationMs,
    }),
    ...detectExpression(session, cfg, invalid, from, to, baseline, { names: cfg.exprSurprise, tone: 'negative' }),
    ...detectExpression(session, cfg, invalid, from, to, baseline, { names: cfg.exprPositive, tone: 'positive' }),
    ...detectBreathHold(session, cfg, invalid, from, to, baseline),
    ...detectBlink(session, cfg, invalid, from, to, baseline),
    ...detectBreathRate(session, cfg, invalid, from, to),
  ];

  const events = session.events || [];
  // Positive and negative reactions never join into one moment.
  const positive = hits.filter((h) => h.tone === 'positive');
  const groups = [...mergeHits(hits.filter((h) => h.tone !== 'positive'), cfg), ...mergeHits(positive, cfg)];
  const moments = groups.map((group, index) => {
    const kinds = [...new Set(group.hits.map((h) => h.kind))];
    const score = kinds.reduce((sum, k) => sum + WEIGHTS[k], 0);
    // The strongest fast signal gives the best time. Slow averages point to a window.
    const fast = strongestFast(group.hits);
    const t = fast ? fast.onset : Math.round((group.start + group.end) / 2);
    return {
      id: `m${index + 1}`,
      t,
      window: { start: Math.max(from, group.start - 2000), end: group.end },
      strength: kinds.length >= 2 ? 'strong' : 'single',
      tone: group.hits[0].tone === 'positive' ? 'positive' : 'negative',
      score,
      signals: group.hits.map(({ kind, tone, label, detail, delta, onset, end }) => ({ kind, tone, label, detail, delta, onset, end })),
      // With a fast signal, the cause is on screen before that signal. A slow signal
      // in the same moment must not pull in events that came after it.
      events: events.filter((e) => e.t >= group.start - 2000 && e.t <= (fast ? t : group.end) + 1000),
      url: [...events].reverse().find((e) => e.t <= group.end && e.url)?.url || null,
    };
  });

  moments.sort((a, b) => b.score - a.score || a.t - b.t);
  return { moments, summary: summarise(session, invalid, from, to, baseline, cfg) };
}

module.exports = { detectMoments, DEFAULTS, median, mean };
