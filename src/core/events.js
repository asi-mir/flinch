'use strict';
// Plain-English text for the things that happen on the tested page.

const EVENT_TEXT = {
  click: (e) => `Clicked "${e.text}"`,
  'rage-click': (e) => `Clicked "${e.text}" ${e.count || 3} times fast`,
  typing: (e) => `Typed in "${e.text}"`,
  change: (e) => `Changed "${e.text}"`,
  submit: () => 'Sent the form',
  'validation-error': (e) => `The form rejected "${e.text}"`,
  'error-shown': (e) => `The page showed: "${e.text}"`,
  'js-error': (e) => `The page had a script error: ${e.text}`,
  navigate: (e) => `Went to ${e.text}`,
  'slow-load': (e) => e.text,
  'load-failed': (e) => `A page failed to load: ${e.text}`,
  scroll: (e) => `Scrolled ${e.direction} (${e.percent}% of the page)`,
};

function describeEvent(e) {
  return (EVENT_TEXT[e.type] || (() => e.type))(e);
}

// The events shown for a moment: no scrolling, the last six.
function momentEvents(moment) {
  return moment.events.filter((e) => e.type !== 'scroll').slice(-6);
}

module.exports = { describeEvent, momentEvents };
