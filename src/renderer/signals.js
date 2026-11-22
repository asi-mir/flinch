'use strict';
// One interface for "where the body signals come from":
//   real  -> SmartSpectra SDK reading the camera
//   sim   -> made-up numbers, for trying the app without a camera or a key
//
// Both call the same handlers:
//   onSamples(samples)        samples from src/core/normalize.js, t in ms (source clock)
//   onValidation(ok, hint)    is the measurement usable right now, and why not
//   onStream(mediaStream)     camera preview (real source only)
//   onError(message, fatal)
const { normalizeMetrics } = require('../core/normalize');

function createSdkSource(apiKey, handlers, options = {}) {
  const sdkModule = require('@smartspectra/node-sdk/renderer');
  const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
  const { SmartSpectraSDK, MetricType, ValidationCode, SmartSpectraErrorCode, breathingMetrics, cardioMetrics } = sdkModule;

  // Face landmarks are not requested: 478 points per frame that Flinch does not use.
  const faceMetrics = [MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS];
  let sdk = null;
  let withFace = true;
  const trace = handlers.onTrace || (() => {});
  // A camera the user picked. With none picked, the SDK opens the default camera itself.
  let deviceId = options.deviceId || null;
  let ownStream = null;

  async function openCamera() {
    if (!deviceId) return;
    try {
      ownStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch {
      deviceId = null; // that camera is gone: fall back to the default one
      return;
    }
    sdk.useMediaStream(ownStream);
    handlers.onStream?.(ownStream);
  }

  // The SDK never stops a stream it was given, so this side must.
  function closeCamera() {
    if (!ownStream) return;
    for (const track of ownStream.getTracks()) track.stop();
    ownStream = null;
  }

  function build() {
    sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...(withFace ? faceMetrics : [])],
      // No SDK usage reports are sent to Presage. See the README, "Privacy".
      enableTelemetry: false,
    });
    sdk.on('streamAvailable', (stream) => handlers.onStream?.(stream));
    sdk.on('metrics', (buf) => {
      const metrics = decodeMetrics(buf);
      trace('metrics', metrics);
      const samples = normalizeMetrics(metrics);
      if (samples.length) handlers.onSamples(samples);
    });
    sdk.on('processingStatus', (...args) => trace('processingStatus', args));
    sdk.on('validationStatus', (code, _ts, hint) => {
      trace('validationStatus', { code, hint });
      // Only kOk counts. Seen with SDK 3.5.0: while it reports "chest not visible" it
      // sends blink and talk data only, and no pulse or breathing.
      const ok = code === ValidationCode.kOk;
      handlers.onValidation(ok, hint || '', code);
    });
    sdk.on('error', (code, message, retryable) => {
      trace('error', { code, message, retryable });
      handlers.onError(describeError(code, message), !retryable);
    });
  }

  function describeError(code, message) {
    const E = SmartSpectraErrorCode;
    if (code === E.kAuthenticationFailed) return 'The SmartSpectra API key was not accepted. Check it in Settings.';
    if (code === E.kCreditExhausted) return 'The SmartSpectra account has no credit left.';
    if (code === E.kNetworkError) return 'No connection to Presage. The SDK needs the internet to sign in.';
    if (code === E.kInputUnavailable) return 'The camera is not available. Another app may be using it.';
    if (code === E.kSustainedLowFrameRate) return 'The camera frame rate stayed too low to measure.';
    return message || `SmartSpectra error ${code}`;
  }

  return {
    simulated: false,
    get faceAvailable() {
      return withFace;
    },
    get deviceId() {
      return deviceId;
    },
    async start() {
      build();
      await openCamera();
      try {
        try {
          await sdk.start();
        } catch (err) {
          if (err.code !== SmartSpectraErrorCode.kMetricNotAuthorized || !withFace) throw err;
          // This key cannot use face metrics. Carry on with pulse and breathing.
          withFace = false;
          sdk.destroy();
          build();
          if (ownStream) sdk.useMediaStream(ownStream);
          await sdk.start();
        }
      } catch (err) {
        closeCamera();
        throw new Error(describeError(err.code, err.message));
      }
    },
    async stop() {
      if (!sdk) return closeCamera();
      try {
        await sdk.stop();
      } finally {
        sdk.destroy();
        sdk = null;
        closeCamera();
      }
    },
    // Switch to another camera (null = the default one). Restarts the measurement.
    async setCamera(id) {
      await this.stop();
      deviceId = id || null;
      await this.start();
    },
    poke() {},
  };
}

// Made-up signals. They react to trouble on the tested page so the whole flow can be tried.
function createSimSource(handlers) {
  let timer = null;
  let t = 0;
  let pulse = 68;
  let nextBlink = 2000;
  let blinkUntil = 0;
  const reactions = [];
  const STEP = 100;

  function tick() {
    t += STEP;
    const active = reactions.filter((r) => t >= r.at && t <= r.at + 22000);
    const since = active.length ? t - active[active.length - 1].at : null;
    const samples = [];

    // Pulse climbs a few seconds after a reaction (the real value is a 12 s average).
    let target = 68 + Math.sin(t / 9000) * 1.2;
    if (since != null && since > 3000 && since < 18000) target += 11 * Math.sin(((since - 3000) / 15000) * Math.PI);
    pulse += (target - pulse) * 0.06;
    if (t % 1000 === 0) {
      samples.push({ kind: 'pulse', t, v: pulse + (Math.random() - 0.5) * 0.6, conf: 80, stable: true });
      samples.push({ kind: 'breath', t, v: 14 + Math.sin(t / 20000) * 0.8, conf: 80, stable: true });
    }
    if (t % 5000 === 0 && t >= 60000) {
      samples.push({ kind: 'hrv', t, v: 42 + Math.sin(t / 30000) * 4, sdnn: 50, baevsky: 90, conf: 70, stable: true });
    }

    const holding = since != null && since > 400 && since < 5600;
    const breath = holding ? 0.02 * Math.sin(t / 300) : Math.sin((t / 1000) * 2 * Math.PI * (14 / 60));
    samples.push({ kind: 'breathTrace', t, v: breath, stable: true });
    samples.push({ kind: 'pulseTrace', t, v: Math.sin((t / 1000) * 2 * Math.PI * (pulse / 60)), stable: true });

    if (t >= nextBlink) {
      blinkUntil = t + 180;
      nextBlink = t + 2500 + Math.random() * 3500;
    }
    samples.push({ kind: 'blink', t, v: t < blinkUntil ? 1 : 0 });

    const upset = since != null && since > 200 && since < 2800;
    samples.push({
      kind: 'expr',
      t,
      v: upset ? { neutral: 0.25, angry: 0.55, surprise: 0.15 } : { neutral: 0.88, happy: 0.06, angry: 0.03 },
    });
    handlers.onSamples(samples);
  }

  return {
    simulated: true,
    faceAvailable: true,
    async start() {
      handlers.onValidation(true, '', 0);
      timer = setInterval(tick, STEP);
    },
    async stop() {
      clearInterval(timer);
      timer = null;
    },
    // Called when something goes wrong on the tested page.
    poke() {
      if (!reactions.length || t - reactions[reactions.length - 1].at > 20000) reactions.push({ at: t });
    },
  };
}

module.exports = { createSdkSource, createSimSource };
