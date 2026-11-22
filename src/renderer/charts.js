'use strict';
const { clock } = require('./dom');
const { DEFAULTS } = require('../core/detector');

const COLORS = {
  ink: '#1c1b19',
  faint: '#8a867e',
  grid: '#e7e4dd',
  pulse: '#c2255c',
  breath: '#1971c2',
  face: '#7048e8',
  moment: '#d9480f',
  positive: '#2b8a3e',
  invalid: 'rgba(138, 134, 126, 0.16)',
};

function setup(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

// A small live trace: the last few seconds of a waveform.
function drawTrace(canvas, values, color) {
  const { ctx, width, height } = setup(canvas);
  ctx.clearRect(0, 0, width, height);
  if (values.length < 2) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - 3 - ((v - lo) / span) * (height - 6);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function negative(scores) {
  let total = 0;
  for (const name of DEFAULTS.exprNegative) total += scores[name] || 0;
  return Math.min(1, total);
}

// The report timeline: pulse, face, breathing depth, page events and the moments.
function drawTimeline(canvas, session, options = {}) {
  const { ctx, width, height } = setup(canvas);
  const { start, end } = session.test;
  const pad = { left: 44, right: 12, top: 26, bottom: 22 };
  const plotW = width - pad.left - pad.right;
  const x = (t) => pad.left + ((t - start) / (end - start)) * plotW;
  const rows = {
    pulse: { top: pad.top, height: (height - pad.top - pad.bottom) * 0.5 },
    face: { top: pad.top + (height - pad.top - pad.bottom) * 0.56, height: (height - pad.top - pad.bottom) * 0.18 },
    breath: { top: pad.top + (height - pad.top - pad.bottom) * 0.8, height: (height - pad.top - pad.bottom) * 0.2 },
  };
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // Periods when the measurement was not usable.
  ctx.fillStyle = COLORS.invalid;
  for (const iv of session.invalid || []) {
    const a = Math.max(start, iv.start);
    const b = Math.min(end, iv.end);
    if (b > a) ctx.fillRect(x(a), pad.top, Math.max(1, x(b) - x(a)), height - pad.top - pad.bottom);
  }

  // Time axis.
  const step = [5, 10, 15, 30, 60, 120, 300].map((s) => s * 1000).find((s) => (end - start) / s <= 10) || 600000;
  ctx.fillStyle = COLORS.faint;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  for (let t = 0; t <= end - start; t += step) {
    const px = Math.round(x(start + t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, height - pad.bottom);
    ctx.stroke();
    ctx.fillText(clock(t), px, height - pad.bottom / 2);
  }

  // Pulse line (trusted samples only).
  const pulse = (session.samples.pulse || []).filter((s) => s.stable && s.t >= start && s.t <= end);
  if (pulse.length > 1) {
    let lo = Math.min(...pulse.map((s) => s.v));
    let hi = Math.max(...pulse.map((s) => s.v));
    if (hi - lo < 10) {
      const mid = (hi + lo) / 2;
      lo = mid - 5;
      hi = mid + 5;
    }
    const y = (v) => rows.pulse.top + rows.pulse.height - ((v - lo) / (hi - lo)) * rows.pulse.height;
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.pulse;
    ctx.fillText(Math.round(hi), pad.left - 6, rows.pulse.top + 4);
    ctx.fillText(Math.round(lo), pad.left - 6, rows.pulse.top + rows.pulse.height - 4);
    ctx.beginPath();
    let prev = null;
    for (const s of pulse) {
      // A gap of more than 4 s means the measurement dropped out: lift the pen.
      if (prev && s.t - prev.t < 4000) ctx.lineTo(x(s.t), y(s.v));
      else ctx.moveTo(x(s.t), y(s.v));
      prev = s;
    }
    ctx.strokeStyle = COLORS.pulse;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Face: how strong the negative expression is.
  const expr = (session.samples.expr || []).filter((s) => s.t >= start && s.t <= end);
  if (expr.length > 1) {
    const base = rows.face.top + rows.face.height;
    ctx.beginPath();
    ctx.moveTo(x(expr[0].t), base);
    for (const s of expr) ctx.lineTo(x(s.t), base - negative(s.v) * rows.face.height);
    ctx.lineTo(x(expr[expr.length - 1].t), base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(112, 72, 232, 0.55)';
    ctx.fill();
  }

  // Breathing: the chest trace.
  const breath = (session.samples.breathTrace || []).filter((s) => s.t >= start && s.t <= end);
  if (breath.length > 1) {
    const lo = Math.min(...breath.map((s) => s.v));
    const hi = Math.max(...breath.map((s) => s.v));
    const y = (v) => rows.breath.top + rows.breath.height - ((v - lo) / (hi - lo || 1)) * rows.breath.height;
    ctx.beginPath();
    breath.forEach((s, i) => (i ? ctx.lineTo(x(s.t), y(s.v)) : ctx.moveTo(x(s.t), y(s.v))));
    ctx.strokeStyle = COLORS.breath;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Row labels.
  ctx.textAlign = 'left';
  const rowLabel = (text, color, top) => {
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(pad.left + 1, top - 7, w, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, pad.left + 6, top);
  };
  rowLabel('Pulse (bpm)', COLORS.pulse, rows.pulse.top + 8);
  rowLabel('Face', COLORS.face, rows.face.top + 6);
  rowLabel('Breathing', COLORS.breath, rows.breath.top + 4);

  // Page events as small ticks along the top.
  for (const e of session.events || []) {
    const trouble = ['rage-click', 'validation-error', 'error-shown', 'js-error', 'load-failed', 'slow-load'].includes(e.type);
    ctx.fillStyle = trouble ? COLORS.moment : COLORS.faint;
    ctx.fillRect(Math.round(x(e.t)), pad.top - 8, trouble ? 2 : 1, 6);
  }

  // Moments: a band for the window and a numbered pin.
  const pins = [];
  for (const m of options.moments || []) {
    const a = x(Math.max(start, m.window.start));
    const b = x(Math.min(end, m.window.end));
    const selected = options.selected === m.id;
    const positive = m.tone === 'positive';
    const color = positive ? COLORS.positive : COLORS.moment;
    const band = positive ? '43, 138, 62' : '217, 72, 15';
    ctx.fillStyle = `rgba(${band}, ${selected ? 0.22 : 0.1})`;
    ctx.fillRect(a, pad.top, Math.max(2, b - a), height - pad.top - pad.bottom);
    const px = x(m.t);
    ctx.beginPath();
    ctx.arc(px, 11, 9, 0, Math.PI * 2);
    ctx.fillStyle = m.strength === 'strong' || selected ? color : '#fff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = m.strength === 'strong' || selected ? '#fff' : color;
    ctx.textAlign = 'center';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(String(m.number), px, 11.5);
    ctx.font = '11px system-ui, sans-serif';
    pins.push({ id: m.id, x: px });
  }

  // Hover line.
  if (options.hoverT != null) {
    const px = Math.round(x(options.hoverT)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, height - pad.bottom);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return {
    pins,
    timeAt: (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = (clientX - rect.left - pad.left) / plotW;
      return start + Math.min(1, Math.max(0, ratio)) * (end - start);
    },
  };
}

module.exports = { drawTrace, drawTimeline, COLORS };
