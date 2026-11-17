'use strict';
// Collects everything that belongs to one test: samples, page events, the periods
// when the measurement was not usable, and the two phases (baseline, test).

const KINDS = ['pulse', 'breath', 'breathTrace', 'pulseTrace', 'blink', 'talk', 'expr', 'hrv'];
// pulseTrace and talk are shown live but not stored: the report does not use them.
const STORED = new Set(['pulse', 'breath', 'breathTrace', 'blink', 'expr', 'hrv']);

class Recorder {
  constructor() {
    this.startedAt = performance.now();
    this.offset = null; // source clock -> session clock
    this.samples = Object.fromEntries(KINDS.filter((k) => STORED.has(k)).map((k) => [k, []]));
    this.latest = {};
    this.events = [];
    this.invalid = [];
    this.openInvalid = null;
    this.baseline = null;
    this.test = null;
    this.recording = false;
  }

  now() {
    return performance.now() - this.startedAt;
  }

  // Samples carry the camera frame time. Map it to the session clock using the
  // smallest delay seen so far, so jitter in delivery does not move samples around.
  addSamples(samples) {
    const arrival = this.now();
    let newest = -Infinity;
    for (const s of samples) if (s.t > newest) newest = s.t;
    const candidate = arrival - newest;
    if (this.offset == null || candidate < this.offset) this.offset = candidate;
    for (const s of samples) {
      const sample = { ...s, t: Math.round(s.t + this.offset) };
      delete sample.kind;
      this.latest[s.kind] = sample;
      if (this.recording && STORED.has(s.kind)) this.samples[s.kind].push(sample);
    }
  }

  setValidation(ok, hint) {
    const t = this.now();
    if (ok) {
      if (this.openInvalid) {
        this.openInvalid.end = t;
        this.openInvalid = null;
      }
    } else if (!this.openInvalid) {
      this.openInvalid = { start: t, end: t, reason: hint || 'Measurement not usable' };
      if (this.recording) this.invalid.push(this.openInvalid);
    } else {
      this.openInvalid.end = t;
      if (hint) this.openInvalid.reason = hint;
    }
  }

  beginRecording() {
    this.recording = true;
    if (this.openInvalid) this.invalid.push(this.openInvalid);
  }

  beginBaseline() {
    this.beginRecording();
    this.baseline = { start: this.now(), end: null };
  }

  endBaseline() {
    this.baseline.end = this.now();
  }

  beginTest() {
    this.test = { start: this.now(), end: null };
  }

  endTest() {
    const t = this.now();
    this.test.end = t;
    if (this.openInvalid) this.openInvalid.end = t;
    this.recording = false;
  }

  addEvent(event) {
    if (!this.test || this.test.end) return null;
    const e = { t: Math.round(this.now()), ...event };
    this.events.push(e);
    return e;
  }

  toJSON() {
    const round = (iv) => iv && { start: Math.round(iv.start), end: Math.round(iv.end) };
    return {
      samples: this.samples,
      events: this.events,
      invalid: this.invalid.map((iv) => ({ ...round(iv), reason: iv.reason })),
      baseline: round(this.baseline),
      test: round(this.test),
    };
  }
}

module.exports = { Recorder };
