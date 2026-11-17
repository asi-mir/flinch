'use strict';
// Sessions live in plain files on this computer:
//   <userData>/sessions/<id>/session.json
//   <userData>/sessions/<id>/shots/<ms>.jpg
const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[a-z0-9-]{8,40}$/;

class Store {
  constructor(root) {
    this.root = path.join(root, 'sessions');
    fs.mkdirSync(this.root, { recursive: true });
  }

  dir(id) {
    if (!ID_PATTERN.test(id)) throw new Error('Bad session id');
    return path.join(this.root, id);
  }

  create() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).toLowerCase();
    const id = `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    fs.mkdirSync(path.join(this.dir(id), 'shots'), { recursive: true });
    return id;
  }

  save(id, data) {
    const file = path.join(this.dir(id), 'session.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
    fs.renameSync(`${file}.tmp`, file);
  }

  load(id) {
    const dir = this.dir(id);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
    return { data, shotsDir: path.join(dir, 'shots') };
  }

  saveShot(id, t, jpeg) {
    const name = `${Math.round(t)}.jpg`;
    fs.writeFileSync(path.join(this.dir(id), 'shots', name), jpeg);
    return name;
  }

  list() {
    const out = [];
    for (const id of fs.readdirSync(this.root)) {
      if (!ID_PATTERN.test(id)) continue;
      try {
        const { data } = this.load(id);
        out.push({
          id,
          createdAt: data.createdAt,
          url: data.url,
          task: data.task,
          simulated: !!data.simulated,
          durationMs: data.test ? data.test.end - data.test.start : 0,
          moments: data.result ? data.result.moments.length : 0,
        });
      } catch {
        // A folder without a finished session.json is an abandoned test. Remove it.
        fs.rmSync(path.join(this.root, id), { recursive: true, force: true });
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
  }

  removeAll() {
    fs.rmSync(this.root, { recursive: true, force: true });
    fs.mkdirSync(this.root, { recursive: true });
  }
}

module.exports = { Store };
