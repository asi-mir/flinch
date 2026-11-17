'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verify } = require('../src/main/notes');
const { shotAt, shotForMoment } = require('../src/core/shots');

const data = {
  result: {
    moments: [
      { id: 'm1', t: 20000, strength: 'strong', events: [{ t: 19000, type: 'click', text: 'Continue' }, { t: 19200, type: 'error-shown', text: 'Invalid input.' }] },
      { id: 'm2', t: 40000, strength: 'single', events: [] },
    ],
  },
};
const note = (over) => ({ moment_id: 'm1', headline: 'h', what_happened: 'w', suggestion: 's', based_on: 'event', event_number: 2, confidence: 'high', ...over });

test('a note keeps the event it cites', () => {
  const items = verify({ notes: [note()] }, data);
  assert.strictEqual(items.m1.basedOn, 'event');
  assert.strictEqual(items.m1.eventT, 19200);
});

test('a note for a moment that does not exist is dropped', () => {
  assert.deepStrictEqual(verify({ notes: [note({ moment_id: 'm9' })] }, data), {});
});

test('a note that cites a missing event becomes "unclear"', () => {
  const items = verify({ notes: [note({ event_number: 7 })] }, data);
  assert.strictEqual(items.m1.basedOn, 'unclear');
  assert.strictEqual(items.m1.eventT, null);
});

test('a one-signal moment cannot carry a high-confidence note', () => {
  const items = verify({ notes: [note({ moment_id: 'm2', based_on: 'screenshot', event_number: null })] }, data);
  assert.strictEqual(items.m2.confidence, 'medium');
});

test('only the first note per moment is kept', () => {
  const items = verify({ notes: [note({ headline: 'first' }), note({ headline: 'second' })] }, data);
  assert.strictEqual(items.m1.headline, 'first');
});

test('a moment shows the first screenshot after its last page event', () => {
  const shots = [17000, 19000, 19550, 21000];
  assert.strictEqual(shotForMoment(shots, data.result.moments[0]), 19550);
  assert.strictEqual(shotForMoment(shots, data.result.moments[1]), 21000);
  assert.strictEqual(shotAt(shots, 18000), 17000);
  assert.strictEqual(shotAt([], 5), null);
});
