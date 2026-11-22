'use strict';
// Which screenshot goes with a point in time. `shots` is a sorted list of capture times (ms).

// The newest screenshot taken at or before t (with a small grace period).
function shotAt(shots, t) {
  let best = null;
  for (const s of shots) {
    if (s <= t + 400) best = s;
    else break;
  }
  return best ?? shots[0] ?? null;
}

// The screen the tester was reacting to.
// A face reaction or a held breath is almost instant, so take a screenshot from while
// it lasted: a page can change with no click (a delayed error, a popup), and the
// newest screenshot before the reaction may be from just before that change.
// Pulse and breathing rate react late, so take the first screenshot after the last
// thing that happened on the page before the reaction.
function shotForMoment(shots, moment) {
  // The strongest fast signal, the same one that sets the moment's time.
  const fast = (moment.signals || [])
    .filter((s) => s.kind === 'expression' || s.kind === 'breathHold')
    .sort((a, b) => b.delta - a.delta || a.onset - b.onset)[0];
  if (fast) return shots.find((s) => s >= fast.onset && s <= fast.end) ?? shotAt(shots, fast.onset);
  const before = moment.events.filter((e) => e.type !== 'scroll' && e.t <= moment.t + 500).pop();
  if (before) {
    const after = shots.find((s) => s >= before.t + 150 && s <= before.t + 3000);
    if (after != null) return after;
  }
  return shotAt(shots, moment.t);
}

module.exports = { shotAt, shotForMoment };
