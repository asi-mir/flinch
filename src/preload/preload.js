'use strict';
// Bridge for Flinch's own window.
require('@smartspectra/node-sdk/preload'); // exposes the SmartSpectra bridge to the renderer SDK

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('flinch', {
  info: call('app:info'),
  getKey: call('key:get'),
  setKey: call('key:set'),
  cameraAccess: call('camera:access'),
  listSessions: call('sessions:list'),
  createSession: call('sessions:create'),
  saveSession: call('sessions:save'),
  loadSession: call('sessions:load'),
  deleteSession: call('sessions:delete'),
  deleteAllSessions: call('sessions:deleteAll'),
  captureShot: call('shots:capture'),
  exportFile: call('export:save'),
  writeNotes: call('notes:write'),
});
