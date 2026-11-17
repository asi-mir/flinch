'use strict';
// Bundles the renderer and the preload script. The SmartSpectra renderer SDK is
// CommonJS, and a sandboxed preload cannot require packages, so both need a bundle.
const esbuild = require('esbuild');
const path = require('node:path');

const root = path.join(__dirname, '..');
const common = { bundle: true, sourcemap: 'inline', logLevel: 'info', target: 'chrome120' };

async function build() {
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/renderer/app.js')],
    outfile: path.join(root, 'dist/renderer.js'),
    platform: 'browser',
    format: 'iife',
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/preload/preload.js')],
    outfile: path.join(root, 'dist/preload.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
