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

// The screen the tester was reacting to: the first screenshot after the last thing that
// happened on the page before the reaction. Screens stay up, so "just after" is right.
function shotForMoment(shots, moment) {
  const before = moment.events.filter((e) => e.type !== 'scroll' && e.t <= moment.t + 500).pop();
  if (before) {
    const after = shots.find((s) => s >= before.t + 150 && s <= before.t + 3000);
    if (after != null) return after;
  }
  return shotAt(shots, moment.t);
}

module.exports = { shotAt, shotForMoment };
