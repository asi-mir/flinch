'use strict';
// Runs inside the tested page. It reports WHAT the tester did, never what they typed:
// no field values, no key codes, no clipboard, no page content beyond short labels.
const { ipcRenderer } = require('electron');

const send = (type, data = {}) => ipcRenderer.sendToHost('flinch-event', { type, ...data });
const clip = (text, max = 60) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

function fieldLabel(el) {
  if (!el || !el.tagName) return '';
  if (el.type === 'password') return 'password field';
  const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  return clip(
    (id && id.textContent) ||
      el.getAttribute('aria-label') ||
      el.closest('label')?.textContent ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.tagName.toLowerCase(),
    40,
  );
}

function clickLabel(el) {
  const target = el.closest('button, a, [role="button"], input, select, textarea, label, summary') || el;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return { tag, text: fieldLabel(target) };
  return { tag, text: clip(target.getAttribute('aria-label') || target.innerText || target.getAttribute('title') || tag) };
}

window.addEventListener('DOMContentLoaded', () => {
  let recent = [];
  document.addEventListener(
    'click',
    (e) => {
      const now = performance.now();
      const { tag, text } = clickLabel(e.target);
      send('click', { tag, text });
      recent = recent.filter((c) => now - c.t < 900 && Math.hypot(c.x - e.clientX, c.y - e.clientY) < 40);
      recent.push({ t: now, x: e.clientX, y: e.clientY });
      if (recent.length >= 3) {
        send('rage-click', { text, count: recent.length });
        recent = [];
      }
    },
    true,
  );

  // Typing: only "the tester typed in this field", at most once per second per field.
  const lastTyped = new WeakMap();
  document.addEventListener(
    'input',
    (e) => {
      const now = performance.now();
      if (now - (lastTyped.get(e.target) || 0) < 1000) return;
      lastTyped.set(e.target, now);
      send('typing', { field: fieldLabel(e.target) });
    },
    true,
  );

  document.addEventListener('change', (e) => send('change', { field: fieldLabel(e.target) }), true);
  document.addEventListener('submit', (e) => send('submit', { text: clip(e.target.getAttribute('aria-label') || e.target.id || 'form') }), true);
  document.addEventListener('invalid', (e) => send('validation-error', { field: fieldLabel(e.target) }), true);

  let lastScroll = 0;
  let lastY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const now = performance.now();
      if (now - lastScroll < 1500) return;
      lastScroll = now;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      send('scroll', { direction: window.scrollY >= lastY ? 'down' : 'up', percent: max > 0 ? Math.round((window.scrollY / max) * 100) : 0 });
      lastY = window.scrollY;
    },
    { passive: true },
  );

  // Error messages that appear on the page (role="alert", or a class named like an error).
  const seen = new WeakSet();
  const looksLikeError = (el) =>
    el.nodeType === 1 &&
    (el.getAttribute('role') === 'alert' || /(^|[\s_-])(error|invalid|alert|warning)([\s_-]|$)/i.test(el.className?.toString() || ''));
  let lastError = { text: '', at: 0 };
  const report = (el) => {
    if (seen.has(el) || !el.innerText?.trim() || !el.offsetParent) return;
    seen.add(el);
    const text = clip(el.innerText, 90);
    const now = performance.now();
    if (text === lastError.text && now - lastError.at < 1500) return;
    lastError = { text, at: now };
    send('error-shown', { text });
  };
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (looksLikeError(m.target)) report(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (looksLikeError(node)) report(node);
        node.querySelectorAll?.('[role="alert"], [class*="error" i]').forEach((el) => looksLikeError(el) && report(el));
      }
      if (m.type === 'characterData' || m.addedNodes.length) {
        const host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const err = host?.closest?.('[role="alert"], [class*="error" i]');
        if (err && looksLikeError(err)) {
          seen.delete(err);
          report(err);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
});

window.addEventListener('error', (e) => send('js-error', { text: clip(e.message, 90) }));
