'use strict';
const { h, clock } = require('./dom');
const { drawTimeline } = require('./charts');
const { shotAt, shotForMoment } = require('../core/shots');
const { describeEvent, momentEvents } = require('../core/events');

// Moments in the order they happened, numbered 1..n.
function ordered(data) {
  return [...data.result.moments].sort((a, b) => a.t - b.t).map((m, i) => ({ ...m, number: i + 1 }));
}

function toMarkdown(data) {
  const { summary } = data.result;
  const moments = ordered(data);
  const rel = (t) => clock(t - data.test.start);
  const lines = [
    `# Flinch report`,
    '',
    `- Site: ${data.url}`,
    `- Task: ${data.task || '(none)'}`,
    `- Date: ${new Date(data.createdAt).toLocaleString()}`,
    `- Length: ${clock(summary.durationMs)}, measured ${summary.measuredPct}% of the time`,
    `- Pulse: ${summary.pulse.baseline ?? '--'} bpm at rest, ${summary.pulse.test ?? '--'} bpm on average during the task, ${summary.pulse.max ?? '--'} bpm at the highest`,
    data.simulated ? '- **Preview mode: the body signals in this report are made up.**' : null,
    '',
    `## ${moments.length} reaction moment${moments.length === 1 ? '' : 's'}`,
    '',
  ];
  for (const m of moments) {
    lines.push(`### ${m.number}. At ${rel(m.t)} on ${m.url || data.url} (${m.strength === 'strong' ? 'two or more signals' : 'one signal'})`, '');
    lines.push('Body:', ...m.signals.map((s) => `- ${s.label}. ${s.detail}`), '');
    const note = data.notes?.items?.[m.id];
    if (note) lines.push(`AI note (${note.confidence} confidence): **${note.headline}** ${note.whatHappened} Try: ${note.suggestion}`, '');
    const events = momentEvents(m);
    if (events.length) lines.push('On screen just before:', ...events.map((e) => `- ${rel(e.t)} ${describeEvent(e)}`), '');
  }
  lines.push(
    '---',
    'A reaction moment is a hint, not a verdict. It shows where the tester\'s body changed. Look at the screen and ask the tester what happened. Flinch is not a medical tool.',
  );
  return lines.filter((l) => l != null).join('\n');
}

function showReport({ root, data, shotsUrl, api, onBack, banner, aiNotes }) {
  const moments = ordered(data);
  const { summary } = data.result;
  const rel = (t) => clock(t - data.test.start);
  const shotSrc = (t) => {
    const shot = shotAt(data.shots || [], t);
    return shot == null ? null : `${shotsUrl}/${shot}.jpg`;
  };

  let selected = null;
  let hoverT = null;
  let layout = null;
  const canvas = h('canvas', { class: 'timeline' });
  const scrubImage = h('img', { class: 'scrub-shot', alt: 'The tested page at the time under the pointer' });
  const scrubLabel = h('p', { class: 'muted small' }, 'Move over the timeline to see the screen at that time.');
  const cards = new Map();

  const redraw = () => {
    layout = drawTimeline(canvas, data, { moments, selected, hoverT });
  };
  const select = (id, scroll) => {
    selected = id;
    for (const [key, card] of cards) card.classList.toggle('selected', key === id);
    if (scroll) cards.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    redraw();
  };

  canvas.addEventListener('mousemove', (e) => {
    hoverT = layout.timeAt(e.clientX);
    const src = shotSrc(hoverT);
    if (src) scrubImage.src = src;
    const pulse = (data.samples.pulse || []).filter((s) => s.stable && Math.abs(s.t - hoverT) < 2500).pop();
    scrubLabel.textContent = `${rel(hoverT)}${pulse ? ` · pulse ${Math.round(pulse.v)} bpm` : ''}`;
    redraw();
  });
  canvas.addEventListener('mouseleave', () => {
    hoverT = null;
    redraw();
  });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const pin = layout.pins.map((p) => ({ ...p, d: Math.abs(p.x - px) })).sort((a, b) => a.d - b.d)[0];
    if (pin && pin.d < 40) select(pin.id, true);
  });

  const momentShot = (m) => {
    const shot = shotForMoment(data.shots || [], m);
    return shot == null ? null : `${shotsUrl}/${shot}.jpg`;
  };

  const momentCard = (m) => {
    const src = momentShot(m);
    const events = momentEvents(m);
    const note = data.notes?.items?.[m.id];
    const card = h(
      'article',
      { class: 'moment', onclick: () => select(m.id, false) },
      h(
        'div',
        { class: 'moment-shot' },
        src ? h('img', { src, alt: `The tested page at ${rel(m.t)}`, loading: 'lazy' }) : h('div', { class: 'no-shot' }, 'No screenshot'),
      ),
      h(
        'div',
        { class: 'moment-body' },
        h(
          'header',
          {},
          h('span', { class: `number ${m.strength}` }, m.number),
          h('h3', {}, `At ${rel(m.t)}`),
          h('span', { class: `tag ${m.strength}` }, m.strength === 'strong' ? 'Two or more signals agree' : 'One signal only'),
        ),
        h('p', { class: 'muted small' }, m.url || data.url),
        note
          ? h(
              'div',
              { class: 'note' },
              h('span', { class: 'label' }, `AI note · ${note.confidence} confidence${note.basedOn === 'unclear' ? ' · cause unclear' : ''}`),
              h('p', { class: 'note-head' }, note.headline),
              h('p', {}, note.whatHappened),
              h('p', {}, h('strong', {}, 'Try: '), note.suggestion),
            )
          : null,
        h('div', { class: 'chips' }, m.signals.map((s) => h('span', { class: `chip ${s.kind}`, title: s.detail }, s.label))),
        h('ul', { class: 'evidence' }, m.signals.map((s) => h('li', {}, s.detail))),
        events.length
          ? [h('h4', {}, 'On screen just before'), h('ol', { class: 'events' }, events.map((e) => h('li', { class: note?.eventT === e.t ? 'cited' : null }, h('time', {}, rel(e.t)), describeEvent(e))))]
          : h('p', { class: 'muted small' }, 'No clicks or page changes just before. Look at the screenshot.'),
      ),
    );
    cards.set(m.id, card);
    return card;
  };

  const stat = (label, value, note) => h('div', { class: 'stat' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), note ? h('span', { class: 'muted small' }, note) : null);
  const pulseShift = summary.pulse.baseline != null && summary.pulse.test != null ? summary.pulse.test - summary.pulse.baseline : null;

  root.replaceChildren(
    ...[
      banner,
      h(
        'main',
        { class: 'report' },
        h(
          'header',
          { class: 'report-head' },
          h('button', { onclick: onBack }, '← All tests'),
          h('div', { class: 'grow' }, h('h1', {}, data.task || 'Test report'), h('p', { class: 'muted' }, `${data.url} · ${new Date(data.createdAt).toLocaleString()}`)),
          h(
            'button',
            {
              onclick: () => api.exportFile(`flinch-${data.id}.md`, toMarkdown(data)),
            },
            'Export as Markdown',
          ),
          aiNotes && moments.length
            ? h(
                'button',
                {
                  onclick: async (e) => {
                    const ok = confirm(
                      'Ask Claude to explain these moments?\n\nThis sends to Anthropic: the screenshots of the tested page for each moment, the page events, and the signal changes as text.\n\nIt never sends camera images or anything the tester typed.',
                    );
                    if (!ok) return;
                    const button = e.currentTarget;
                    button.disabled = true;
                    button.textContent = 'Writing notes…';
                    try {
                      data.notes = await api.writeNotes(data.id);
                      showReport({ root, data, shotsUrl, api, onBack, banner, aiNotes });
                    } catch (err) {
                      button.disabled = false;
                      button.textContent = 'Write AI notes';
                      alert(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
                    }
                  },
                },
                data.notes ? 'Rewrite AI notes' : 'Write AI notes',
              )
            : null,
          h(
            'button',
            {
              class: 'danger',
              onclick: async () => {
                if (!confirm('Delete this test, its numbers and its screenshots? This cannot be undone.')) return;
                await api.deleteSession(data.id);
                onBack();
              },
            },
            'Delete',
          ),
        ),
        data.simulated ? h('p', { class: 'notice' }, 'Preview mode: the body signals in this report are made up.') : null,
        data.notes ? h('section', { class: 'card ai-summary' }, h('span', { class: 'label' }, `AI summary · ${data.notes.model}`), h('p', {}, data.notes.summary)) : null,
        h(
          'section',
          { class: 'stats' },
          stat('Reaction moments', moments.length, `${moments.filter((m) => m.strength === 'strong').length} with two or more signals`),
          stat('Length', clock(summary.durationMs), `measured ${summary.measuredPct}% of the time`),
          stat('Pulse at rest', summary.pulse.baseline != null ? `${Math.round(summary.pulse.baseline)} bpm` : '--', 'before the task'),
          stat('Pulse during task', summary.pulse.test != null ? `${Math.round(summary.pulse.test)} bpm` : '--', pulseShift != null ? `${pulseShift >= 0 ? '+' : ''}${pulseShift.toFixed(1)} from rest, highest ${Math.round(summary.pulse.max)}` : ''),
          stat('Breathing', summary.breathing.test != null ? `${Math.round(summary.breathing.test)} /min` : '--', summary.breathing.baseline != null ? `${Math.round(summary.breathing.baseline)} at rest` : ''),
        ),
        h(
          'section',
          { class: 'card timeline-card' },
          h('div', { class: 'timeline-wrap' }, canvas, h('p', { class: 'muted small legend' }, 'Numbered pins are reaction moments. Orange ticks are errors and rage clicks. Grey bands are times when the measurement was not usable.')),
          h('div', { class: 'scrub' }, scrubImage, scrubLabel),
        ),
        h(
          'section',
          { class: 'moments' },
          moments.length
            ? moments.map(momentCard)
            : h('p', { class: 'card muted' }, 'No reaction moments. The tester\'s pulse, breathing, blinking and expression stayed close to their resting level for the whole task.'),
        ),
        h(
          'p',
          { class: 'muted small foot' },
          'A reaction moment is a hint, not a verdict. It shows where the tester\'s body changed, with the numbers behind it. Pulse and breathing are averages over 12 and 30 seconds, so their moments point to a window of time. Look at the screen and ask the tester what happened. Flinch is not a medical tool.',
        ),
      ),
    ].filter(Boolean),
  );
  window.scrollTo(0, 0);

  const first = shotSrc(data.test.start);
  if (first) scrubImage.src = first;
  setTimeout(redraw, 0);
  const onResize = () => canvas.isConnected && redraw();
  window.addEventListener('resize', onResize);
}

module.exports = { showReport, toMarkdown };
