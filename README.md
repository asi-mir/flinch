# Flinch

Watch someone use your site. See the exact screen where their body reacted.

Flinch is a desktop app for usability testing. A tester does a task on a website inside
the app. A normal webcam reads their pulse, breathing, blinking and facial expression
with the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs). When
those signals change against the tester's own resting level, Flinch marks the moment and
shows you the screen, the clicks before it, and the numbers behind it.

No video of the tester is ever recorded. Only numbers are kept, on your computer.

## Run it in 3 steps

You need Node.js 20 or newer and macOS on Apple Silicon, Windows x64 or Linux
(the platforms the SmartSpectra Node SDK supports).

```bash
git clone <this repo> && cd flinch
npm install
cp .env.example .env    # then put your SmartSpectra API key in .env
npm start
```

Get a free trial key at <https://physiology.presagetech.com/auth/register>. You can also
paste the key into the app instead of using `.env`.

**No camera or no key?** Run `npm run preview`. The whole app works, with made-up body
signals and a yellow "Preview mode" banner on every screen.

## What a test looks like

1. **Set up.** Pick the built-in demo shop or type a web address. Write the task.
2. **Consent.** The tester reads what is measured and what is kept, then agrees or not.
3. **Camera check.** Pick a camera. Flinch waits until SmartSpectra reports a pulse it trusts.
4. **30 seconds of calm.** This is the tester's resting level for today.
5. **The task.** The site runs inside the app. A side panel shows the live signals.
6. **The report.** A timeline, and one card per reaction moment.

The demo shop has seven usability problems built in on purpose: a popup with a tiny close
button, a hidden delivery option, an error that says only "Invalid input.", a form that
clears a field, a fee that appears at the end, a slow button with no feedback, and a
false "charged twice" warning with a countdown. It ends on a pleasant note: a free gift
you can open.

## How it finds a moment

| Signal (from SmartSpectra) | What counts as a change | Why the time is a window |
|---|---|---|
| Pulse rate | 6 bpm above its own median from 30 to 10 seconds earlier | It is a 12 second average |
| Facial expression | Angry, fear, disgust and contempt together at 35% or more, and at least 25 points above rest, for 0.7 s | Per frame, so it is exact |
| Sad face | The same rule for "sad" alone, but for 1.5 s. Ignored while the tester types or clicks into a form field: the model reads a face looking down at the keyboard as sad | Per frame |
| Surprised face | The same rule for "surprise" alone | Per frame |
| Happy face | The same rule for "happy". Shown in green as a positive moment, never joined with the others | Per frame |
| Chest breathing trace | Movement under 20% of the usual depth for 4 s (a held breath) | Near exact |
| Blinking | 40% or less of the resting blink rate (a stare), or 220% or more (a flurry) | Counted over 10 seconds |
| Breathing rate | 4 per minute above its own median from 60 to 20 seconds earlier | It is a 30 second average |

Changes that are close in time join into one moment. A moment with two or more
different signals is marked "strong". A moment with one signal is marked "one signal
only". Every number in a card comes from the stored samples, and the rules above are
plain arithmetic in [`src/core/detector.js`](src/core/detector.js).

Flinch trusts the SDK's own quality flags. It uses only pulse and breathing samples that
SmartSpectra marks as stable (the breathing trace carries the breathing-rate flag). When the SDK reports too much movement, bad light or no
face, that period is greyed out on the timeline and nothing is flagged inside it. One exception: when only the chest is out of view, face expressions still count, because they need only the face.

### Optional: AI notes

If `ANTHROPIC_API_KEY` is set, the report gets a "Write AI notes" button. Claude looks at
the screenshot and the page events for each moment and writes what probably caused the
reaction and one fix to try. Code then checks each note: it must point at a real moment,
and an event it cites must exist. A note on a one-signal moment cannot claim high
confidence. Without the key, the app works the same and nothing is sent to Anthropic.

## Privacy

| What | Where it goes |
|---|---|
| Camera frames | Processed on this computer by SmartSpectra, then thrown away. Never saved, never shown in screenshots |
| Pulse, breathing, blink and expression numbers | Saved in the session file on this computer |
| Screenshots of the tested page | Saved on this computer. Deleted with the session |
| What the tester clicked | Saved as short labels ("Clicked Continue") |
| What the tester typed | Keystrokes and field values are never read. Only "typed in the Email field" is noted. But a screenshot shows the page as the tester saw it, so typed text can be visible in a screenshot |
| Web addresses | Saved without the query string |
| SmartSpectra sign-in | The SDK signs in to Presage with your API key. It has no offline mode |
| SmartSpectra usage reports | Turned off (`enableTelemetry: false`) |
| AI notes | Only when you press the button and confirm: screenshots of the page, page events, signal changes as text, the task and the site address go to Anthropic. Never camera images |

- The tester sees a consent screen before the camera starts and can stop at any time.
  "Stop and delete" removes everything from that test.
- Each test starts with a clean in-memory browser. Cookies of the tested site are never
  written to disk, and the tested site cannot use the camera.
- Sessions live in the app's data folder (`sessions/`). Delete one from its report, or
  all of them from the home screen.

## What it cannot do

- **It is not a medical tool.** It says nothing about anyone's health.
- **A moment is a hint.** It shows where the body changed. It does not prove the page
  caused it. Ask the tester.
- The tester must sit fairly still, in good light, with face, shoulders and upper chest
  in the picture. SmartSpectra stops sending pulse and breathing when the chest leaves
  the picture, and Flinch then shows "Measurement paused". A laptop camera is narrow, so
  leaning in to type can cut the chest off. A camera with a wider view works better.
- Talking disturbs the breathing signal, so think-aloud tests lose breathing moments.
- Pulse and breathing rate react late (12 and 30 second averages).
- Pages that refuse to load inside another app's browser view cannot be tested.

## Layout

```
src/core/       detector, sample normaliser, shared helpers (plain Node, tested)
src/main/       Electron main process: window, storage, screenshots, AI notes
src/preload/    bridges for the app window and for the tested page
src/renderer/   the interface: set-up, consent, camera check, test, report
demo-site/      the demo shop with problems on purpose
test/           node --test
```

`npm test` runs the detector and note-checking tests.

## Credits

- [SmartSpectra Node SDK](https://www.npmjs.com/package/@smartspectra/node-sdk) by
  Presage Technologies, used under its own terms.
- [Electron](https://www.electronjs.org), [esbuild](https://esbuild.github.io),
  [Anthropic SDK](https://www.npmjs.com/package/@anthropic-ai/sdk), [Zod](https://zod.dev).

MIT license for the code in this repository.
