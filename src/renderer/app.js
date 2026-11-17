'use strict';
const { h, clock } = require('./dom');
const { Recorder } = require('./recorder');
const { createSdkSource, createSimSource } = require('./signals');
const { detectMoments } = require('../core/detector');
const { showReport } = require('./report');
const { drawTrace, COLORS } = require('./charts');

const api = window.flinch;
const root = document.getElementById('app');
const BASELINE_MS = 30000;
const SHOT_EVERY_MS = 2000;
const TROUBLE = new Set(['rage-click', 'validation-error', 'error-shown', 'js-error', 'load-failed']);

let info = null;

function mount(...nodes) {
  root.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function banner() {
  return info.simulate
    ? h('div', { class: 'banner' }, 'Preview mode: the body signals are made up. No camera is used. Start without --simulate to measure for real.')
    : null;
}

// ---- Home -------------------------------------------------------------------

async function showHome() {
  info = await api.info();
  const sessions = await api.listSessions();

  const url = h('input', { type: 'url', id: 'url', placeholder: 'https://your-site.example', value: '' });
  const task = h('textarea', { id: 'task', rows: 3 }, 'Buy one blue mug. Have it delivered tomorrow.');
  const useDemo = h('input', { type: 'checkbox', id: 'demo', checked: true });
  const sync = () => {
    url.disabled = useDemo.checked;
  };
  useDemo.addEventListener('change', sync);
  sync();

  const error = h('p', { class: 'error', hidden: true });
  const start = () => {
    let target = info.demoUrl;
    if (!useDemo.checked) {
      try {
        const parsed = new URL(url.value.trim());
        if (!/^https?:$/.test(parsed.protocol)) throw new Error();
        target = parsed.href;
      } catch {
        error.textContent = 'Enter a full web address that starts with https://';
        error.hidden = false;
        return;
      }
    }
    if (!info.simulate && !info.hasKey) {
      error.textContent = 'Add your SmartSpectra API key first (below).';
      error.hidden = false;
      return;
    }
    showConsent({ url: target, task: task.value.trim(), demo: useDemo.checked });
  };

  const list = sessions.length
    ? sessions.map((s) =>
        h(
          'button',
          { class: 'session', onclick: () => openReport(s.id) },
          h('span', { class: 'session-title' }, s.task || 'Untitled test'),
          h('span', { class: 'session-meta' }, `${new Date(s.createdAt).toLocaleString()} · ${clock(s.durationMs)} · ${s.moments} moment${s.moments === 1 ? '' : 's'}${s.simulated ? ' · preview' : ''}`),
        ),
      )
    : h('p', { class: 'muted' }, 'No tests yet. Results stay on this computer.');

  mount(
    banner(),
    h(
      'main',
      { class: 'home' },
      h(
        'header',
        { class: 'hero' },
        h('h1', {}, 'Flinch'),
        h('p', { class: 'lede' }, 'Watch someone use your site. See the exact screen where their body reacted.'),
      ),
      h(
        'div',
        { class: 'columns' },
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'New test'),
          h('label', { class: 'check' }, useDemo, 'Use the built-in demo shop (it has problems on purpose)'),
          h('label', { for: 'url' }, 'Or test a site'),
          url,
          h('label', { for: 'task' }, 'Task for the tester'),
          task,
          error,
          h('button', { class: 'primary', onclick: start }, 'Continue to consent'),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Past tests'),
          h('div', { class: 'sessions' }, list),
          sessions.length
            ? h(
                'button',
                {
                  class: 'link danger',
                  onclick: async () => {
                    if (!confirm('Delete every saved test from this computer? This cannot be undone.')) return;
                    await api.deleteAllSessions();
                    showHome();
                  },
                },
                'Delete all tests',
              )
            : null,
        ),
      ),
      keySection(),
    ),
  );
}

function keySection() {
  if (info.simulate) return null;
  const input = h('input', { type: 'password', placeholder: 'SmartSpectra API key', autocomplete: 'off' });
  const status = h(
    'p',
    { class: 'muted' },
    info.keyFromEnv ? 'Using the key from the .env file.' : info.hasKey ? 'A key is saved, encrypted, on this computer.' : 'No key yet. Get one at physiology.presagetech.com.',
  );
  return h(
    'section',
    { class: 'card settings' },
    h('h2', {}, 'SmartSpectra API key'),
    status,
    info.keyFromEnv
      ? null
      : h(
          'div',
          { class: 'row' },
          input,
          h(
            'button',
            {
              onclick: async () => {
                try {
                  await api.setKey(input.value);
                  showHome();
                } catch (err) {
                  status.textContent = err.message;
                }
              },
            },
            'Save key',
          ),
        ),
  );
}

// ---- Consent ----------------------------------------------------------------

function showConsent(plan) {
  const agree = h('input', { type: 'checkbox', id: 'agree' });
  const go = h('button', { class: 'primary', disabled: true, onclick: () => runSession(plan) }, 'I agree. Start the camera check');
  agree.addEventListener('change', () => {
    go.disabled = !agree.checked;
  });
  const item = (title, text) => h('li', {}, h('strong', {}, title), ' ', text);

  mount(
    banner(),
    h(
      'main',
      { class: 'narrow' },
      h('h1', {}, 'Before we start'),
      h('p', { class: 'lede' }, 'This page is for the person doing the test. Read it, then decide.'),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'What Flinch does'),
        h(
          'ul',
          { class: 'consent' },
          item('It uses the camera while you do the task.', info.simulate ? 'In preview mode no camera is used.' : 'From the picture it reads your pulse, your breathing, your blinks and your facial expression.'),
          item('It never records video or photos of you.', 'Camera frames are processed on this computer and thrown away. Only numbers are kept.'),
          item('It keeps screenshots of the site, not of you.', 'It also notes what you click. It never keeps what you type.'),
          item('Everything stays on this computer.', 'Nothing is uploaded. The person running the test can delete it at any time, and so can you: ask them.'),
          item('One connection goes out.', 'The measuring software (Presage SmartSpectra) signs in to its maker with an account key. No video and no body readings are sent.'),
          item('This is not a medical tool.', 'It cannot tell you anything about your health. It only shows where your body reacted during the task.'),
          item('You can stop at any moment.', 'Press "Stop and delete" during the test and nothing is saved.'),
        ),
        h('label', { class: 'check big' }, agree, 'I have read this and I agree to take part.'),
        h('div', { class: 'row' }, go, h('button', { onclick: showHome }, 'Cancel')),
      ),
    ),
  );
}

// ---- Camera check, baseline, test ----------------------------------------------

async function runSession(plan) {
  const recorder = new Recorder();
  const traces = { pulseTrace: [], breathTrace: [] };
  let validation = { ok: false, hint: 'Starting…' };
  let stream = null;
  let stopped = false;
  let fatal = null;
  const video = h('video', { autoplay: true, muted: true, playsInline: true, class: 'preview' });

  const handlers = {
    onSamples(samples) {
      recorder.addSamples(samples);
      for (const s of samples) {
        const buffer = traces[s.kind];
        if (!buffer) continue;
        buffer.push(s.v);
        if (buffer.length > 240) buffer.shift();
      }
    },
    onValidation(ok, hint) {
      validation = { ok, hint };
      recorder.setValidation(ok, hint);
    },
    onStream(mediaStream) {
      stream = mediaStream;
      video.srcObject = mediaStream;
    },
    onError(message, isFatal) {
      if (isFatal) fatal = message;
      else validation = { ok: false, hint: message };
    },
  };

  const source = info.simulate ? createSimSource(handlers) : createSdkSource(await api.getKey(), handlers);
  const cleanUp = async () => {
    stopped = true;
    try {
      await source.stop();
    } catch {
      // The camera is released either way.
    }
  };
  const abort = async (id) => {
    await cleanUp();
    if (id) await api.deleteSession(id);
    showHome();
  };

  // --- Step 1: camera check
  const hint = h('p', { class: 'hint' }, 'Starting the camera…');
  const step = h('h1', {}, 'Camera check');
  const lede = h('p', { class: 'lede' }, 'Sit comfortably, face the screen, and keep your face and upper chest in view.');
  const live = liveReadout(recorder, traces);
  const action = h('div', { class: 'row' });
  const cancel = h('button', { onclick: () => abort(sessionId) }, 'Stop and delete');
  let sessionId = null;

  mount(
    banner(),
    h(
      'main',
      { class: 'narrow' },
      step,
      lede,
      h('section', { class: 'card check-card' }, info.simulate ? h('div', { class: 'preview fake' }, 'No camera in preview mode') : video, h('div', { class: 'check-side' }, hint, live.node, action)),
      h('div', { class: 'row' }, cancel),
    ),
  );

  try {
    if (!info.simulate && !(await api.cameraAccess())) throw new Error('Flinch has no permission to use the camera. Allow it in System Settings, Privacy and Security, Camera.');
    sessionId = await api.createSession();
    await source.start();
  } catch (err) {
    hint.textContent = err.message;
    hint.classList.add('error');
    await cleanUp();
    return;
  }

  // Wait for a pulse reading the SDK itself marks as trustworthy.
  const fail = (err) => {
    hint.textContent = err.message;
    hint.classList.add('error');
    return false;
  };
  const ready = await waitFor(() => {
    if (fatal) throw new Error(fatal);
    live.update();
    hint.textContent = validation.ok ? 'Good. Finding your pulse. This takes about 15 seconds.' : validation.hint || 'Adjusting…';
    return validation.ok && recorder.latest.pulse?.stable;
  }, () => stopped).catch(fail);
  if (!ready) return cleanUp();

  // --- Step 2: baseline
  step.textContent = 'Now relax for 30 seconds';
  lede.textContent = 'Just sit and breathe normally. Flinch is learning what calm looks like for you today.';
  recorder.beginBaseline();
  const baselineEnd = performance.now() + BASELINE_MS;
  const calm = await waitFor(() => {
    if (fatal) throw new Error(fatal);
    live.update();
    const left = baselineEnd - performance.now();
    hint.textContent = validation.ok ? `${Math.ceil(left / 1000)} seconds left` : `${validation.hint || 'Hold still'} (${Math.ceil(left / 1000)} s left)`;
    return left <= 0;
  }, () => stopped).catch(fail);
  if (!calm) return cleanUp();
  recorder.endBaseline();

  step.textContent = 'Ready';
  lede.textContent = 'Your task:';
  hint.textContent = plan.task || 'Use the site as you normally would.';
  hint.classList.add('task-text');
  await new Promise((resolve) => {
    action.append(h('button', { class: 'primary', onclick: resolve }, 'Start the task'));
    const keepLive = () => {
      if (stopped || !action.isConnected) return;
      live.update();
      setTimeout(keepLive, 66);
    };
    keepLive();
  });
  if (stopped) return;

  // --- Step 3: the test
  const shots = [];
  let lastShot = 0;
  let shooting = false;
  let webContentsId = null;
  const view = h('webview', { src: plan.url, partition: info.partition, class: 'site' });
  const address = h('span', { class: 'address' }, '');
  const status = h('span', { class: 'pill' }, 'Measuring');
  const timer = h('span', { class: 'timer' }, '0:00');
  const panel = h('aside', { class: 'panel' }, h('h3', {}, 'Live signals'), live.node, info.simulate ? null : video, h('p', { class: 'muted small' }, 'Video is not recorded. Only numbers are kept.'));
  const togglePanel = h('button', { onclick: () => panel.classList.toggle('hidden') }, 'Hide / show signals');

  const cleanUrl = (raw) => {
    try {
      const u = new URL(raw);
      return u.protocol === 'file:' ? `demo-shop/${u.pathname.split('/').pop()}` : u.origin + u.pathname; // no query string: it can hold personal data
    } catch {
      return '';
    }
  };
  const record = (event) => {
    const saved = recorder.addEvent({ ...event, url: cleanUrl(view.getURL()) });
    if (saved && TROUBLE.has(event.type)) source.poke();
    return saved;
  };
  const shoot = async () => {
    if (shooting || webContentsId == null || !recorder.test || recorder.test.end) return;
    shooting = true;
    const t = Math.round(recorder.now());
    try {
      if (await api.captureShot(sessionId, webContentsId, t)) shots.push(t);
      lastShot = t;
    } finally {
      shooting = false;
    }
  };

  let loadStarted = 0;
  view.addEventListener('dom-ready', () => {
    webContentsId = view.getWebContentsId();
    shoot();
  });
  view.addEventListener('did-start-loading', () => {
    loadStarted = performance.now();
  });
  view.addEventListener('did-stop-loading', () => {
    const took = performance.now() - loadStarted;
    if (loadStarted && took > 3000) record({ type: 'slow-load', text: `Page took ${(took / 1000).toFixed(1)} s to load` });
    loadStarted = 0;
  });
  view.addEventListener('did-navigate', (e) => {
    address.textContent = cleanUrl(e.url);
    record({ type: 'navigate', text: cleanUrl(e.url) });
  });
  view.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    address.textContent = cleanUrl(e.url);
    record({ type: 'navigate', text: cleanUrl(e.url) });
  });
  view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) record({ type: 'load-failed', text: e.errorDescription });
  });
  view.addEventListener('ipc-message', (e) => {
    if (e.channel !== 'flinch-event') return;
    const { type, text, field, tag, direction, percent, count } = e.args[0] || {};
    if (typeof type !== 'string') return;
    record({ type, text: String(text || field || '').slice(0, 100), tag, direction, percent, count });
    if (type === 'click' || type === 'submit' || TROUBLE.has(type)) setTimeout(shoot, 350);
  });

  const finish = async () => {
    await shoot().catch(() => {});
    recorder.endTest();
    await cleanUp();
    const data = {
      version: 1,
      id: sessionId,
      createdAt: new Date().toISOString(),
      url: cleanUrl(plan.url),
      task: plan.task,
      simulated: source.simulated,
      faceAvailable: source.faceAvailable,
      shots,
      ...recorder.toJSON(),
    };
    data.result = detectMoments(data);
    await api.saveSession(sessionId, data);
    openReport(sessionId);
  };

  mount(
    banner(),
    h(
      'div',
      { class: 'test' },
      h(
        'header',
        { class: 'testbar' },
        h('div', { class: 'task' }, h('span', { class: 'label' }, 'Task'), plan.task || 'Use the site as you normally would.'),
        status,
        timer,
        togglePanel,
        h('button', { onclick: () => abort(sessionId) }, 'Stop and delete'),
        h('button', { class: 'primary', onclick: finish }, 'Finish test'),
      ),
      h(
        'div',
        { class: 'browserbar' },
        h('button', { onclick: () => view.canGoBack() && view.goBack(), title: 'Back' }, '←'),
        address,
      ),
      h('div', { class: 'stage' }, h('div', { class: 'site-wrap' }, view), panel),
    ),
  );
  recorder.beginTest();

  const loop = () => {
    if (stopped || !recorder.test || recorder.test.end) return;
    if (fatal) {
      status.textContent = fatal;
      status.className = 'pill bad';
    } else {
      status.textContent = validation.ok ? 'Measuring' : validation.hint || 'Not measuring';
      status.className = validation.ok ? 'pill' : 'pill warn';
    }
    const elapsed = recorder.now() - recorder.test.start;
    timer.textContent = clock(elapsed);
    live.update();
    if (recorder.now() - lastShot >= SHOT_EVERY_MS) shoot();
    setTimeout(loop, 66);
  };
  loop();
}

// Polls a condition once per frame. Resolves false if the session was stopped.
function waitFor(condition, isStopped) {
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        if (isStopped()) return resolve(false);
        if (condition()) return resolve(true);
      } catch (err) {
        return reject(err);
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// The live numbers shown during the camera check and the test.
function liveReadout(recorder, traces) {
  const pulse = h('span', { class: 'big pulse' }, '--');
  const breath = h('span', { class: 'big breath' }, '--');
  const face = h('span', { class: 'big face' }, '--');
  const blink = h('span', { class: 'dot' });
  const pulseCanvas = h('canvas', { class: 'trace' });
  const breathCanvas = h('canvas', { class: 'trace' });
  const node = h(
    'div',
    { class: 'live' },
    h('div', { class: 'metric' }, h('span', { class: 'label' }, 'Pulse'), h('div', {}, pulse, h('span', { class: 'unit' }, 'bpm')), pulseCanvas),
    h('div', { class: 'metric' }, h('span', { class: 'label' }, 'Breathing'), h('div', {}, breath, h('span', { class: 'unit' }, 'per min')), breathCanvas),
    h('div', { class: 'metric' }, h('span', { class: 'label' }, 'Face'), h('div', {}, face, blink)),
  );
  return {
    node,
    update() {
      const { latest } = recorder;
      const fresh = (s) => s && recorder.now() - s.t < 5000;
      pulse.textContent = fresh(latest.pulse) && latest.pulse.stable ? Math.round(latest.pulse.v) : '--';
      breath.textContent = fresh(latest.breath) && latest.breath.stable ? Math.round(latest.breath.v) : '--';
      if (fresh(latest.expr)) {
        const [name, value] = Object.entries(latest.expr.v).sort((a, b) => b[1] - a[1])[0] || ['--', 0];
        face.textContent = `${name} ${Math.round(value * 100)}%`;
      } else face.textContent = '--';
      blink.classList.toggle('on', !!(fresh(latest.blink) && latest.blink.v));
      if (pulseCanvas.isConnected) {
        drawTrace(pulseCanvas, traces.pulseTrace, COLORS.pulse);
        drawTrace(breathCanvas, traces.breathTrace, COLORS.breath);
      }
    },
  };
}

// ---- Report -------------------------------------------------------------------

async function openReport(id) {
  const { data, shotsUrl } = await api.loadSession(id);
  showReport({ root, data, shotsUrl, api, onBack: showHome, banner: info?.simulate ? banner() : null, aiNotes: !!info?.aiNotes });
}

showHome();
