'use strict';
// Optional step: ask Claude to explain each reaction moment in plain words.
//
// The detector decides WHERE the body reacted. Claude only looks at the screen and the
// page events around that time and says what probably caused it. Code then checks every
// note against the recorded evidence before it is shown.
//
// What is sent: screenshots of the tested page, the page events, the signal changes as
// short text, the task and the site address. What is never sent: camera images and raw
// signal data. A screenshot can show text that the tester typed into a form.
const fs = require('node:fs');
const path = require('node:path');
const { Anthropic } = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');
const { shotForMoment } = require('../core/shots');
const { describeEvent, momentEvents } = require('../core/events');

const MODEL = 'claude-opus-5-5';

const NotesSchema = z.object({
  summary: z.string().describe('Two or three short sentences on the main usability problems of this test.'),
  notes: z.array(
    z.object({
      moment_id: z.string().describe('The id of the moment this note is about, for example "m1".'),
      headline: z.string().describe('The likely usability problem in at most eight words.'),
      what_happened: z.string().describe('One or two short sentences: what the tester ran into on this screen.'),
      suggestion: z.string().describe('One concrete change to the page that would remove the problem.'),
      based_on: z.enum(['event', 'screenshot', 'unclear']).describe('What the explanation rests on.'),
      event_number: z.number().int().nullable().describe('When based_on is "event": the number of that event in the moment\'s list. Otherwise null.'),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
});

const SYSTEM = `You help a usability researcher read the results of a moderated test.

A tester did a task on a website while a camera measured their pulse, breathing, blinking and facial expression. A program found the moments where those signals changed against the tester's own resting level. For each moment you get the signal changes, the page events just before it, and a screenshot of the page at that time.

For each moment, say what on the screen most likely caused the reaction and suggest one concrete fix. Some moments are marked positive (the face read as happy). For those, say what on the screen most likely caused it and, as the suggestion, what the team should keep.

Rules:
- Work only from what you are given. A body reaction is a hint that something happened, not proof of a problem. If the screen and the events do not explain it, set based_on to "unclear" and say so plainly. Do not invent a cause.
- When an event explains the reaction, set based_on to "event" and give its number from that moment's list.
- Describe the page, not the person. Do not name emotions as facts, and say nothing about the tester's health, stress level or state of mind.
- Pulse and breathing rate are averages over 12 and 30 seconds, so the cause can be several seconds before the change.
- Write plain English in short sentences. No hype words.`;

function available() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function buildContent(data, shotsDir) {
  const rel = (t) => `${((t - data.test.start) / 1000).toFixed(0)} s`;
  const content = [
    {
      type: 'text',
      text: `Site: ${data.url}\nTask given to the tester: ${data.task || '(none)'}\nTest length: ${Math.round(data.result.summary.durationMs / 1000)} s\nMoments: ${data.result.moments.length}`,
    },
  ];
  const moments = [...data.result.moments].sort((a, b) => a.t - b.t);
  for (const m of moments) {
    const events = momentEvents(m);
    const lines = [
      `--- Moment ${m.id}, at ${rel(m.t)} into the task, page ${m.url || data.url}${m.tone === 'positive' ? ' (positive)' : ''}`,
      'Signal changes:',
      ...m.signals.map((s) => `- ${s.label}. ${s.detail}`),
      events.length ? 'Page events just before:' : 'Page events just before: none',
      ...events.map((e, i) => `${i + 1}. (${rel(e.t)}) ${describeEvent(e)}`),
      'Screenshot of the page at this moment:',
    ];
    content.push({ type: 'text', text: lines.join('\n') });
    const shot = shotForMoment(data.shots || [], m);
    const file = shot == null ? null : path.join(shotsDir, `${shot}.jpg`);
    if (file && fs.existsSync(file)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } });
    } else {
      content.push({ type: 'text', text: '(no screenshot was captured)' });
    }
  }
  return content;
}

// Keeps only notes that point at a real moment, and only event references that exist.
function verify(parsed, data) {
  const byId = new Map(data.result.moments.map((m) => [m.id, m]));
  const items = {};
  for (const note of parsed.notes) {
    const moment = byId.get(note.moment_id);
    if (!moment || items[note.moment_id]) continue;
    const events = momentEvents(moment);
    let { based_on: basedOn, event_number: eventNumber } = note;
    if (basedOn === 'event' && !(eventNumber >= 1 && eventNumber <= events.length)) {
      basedOn = 'unclear';
      eventNumber = null;
    }
    items[note.moment_id] = {
      headline: note.headline,
      whatHappened: note.what_happened,
      suggestion: note.suggestion,
      basedOn,
      eventT: basedOn === 'event' ? events[eventNumber - 1].t : null,
      confidence: moment.strength === 'single' && note.confidence === 'high' ? 'medium' : note.confidence,
    };
  }
  return items;
}

async function writeNotes(data, shotsDir) {
  if (!data.result.moments.length) throw new Error('This test has no reaction moments to explain.');
  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(NotesSchema) },
      // If the model declines a request, the API retries it on its default fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: buildContent(data, shotsDir) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was not accepted.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The Anthropic API is busy. Try again in a minute.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API. Check the internet connection.');
    if (err instanceof Anthropic.APIError) throw new Error(`The Anthropic API returned an error (${err.status}).`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('The model declined to write notes for this test.');
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new Error('The model did not return complete notes. Try again.');

  return {
    model: response.model,
    createdAt: new Date().toISOString(),
    summary: response.parsed_output.summary,
    items: verify(response.parsed_output, data),
  };
}

module.exports = { writeNotes, available, verify };
