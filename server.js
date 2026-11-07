const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { parseFile, setDone, setDate } = require('./parser');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const INBOX_FILE = process.env.INBOX_FILE || 'Inbox.md';
const APP_USER = process.env.APP_USER || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const app = express();
app.use(express.json({ limit: '5mb' }));

// ---------- Optional password (HTTP basic auth) ----------
// Only turned on when APP_PASSWORD is set.
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const encoded = header.split(' ')[1] || '';
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === APP_USER && pass === APP_PASSWORD) {
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Zvezek"');
    res.status(401).send('Login required');
  });
}

// ---------- Static files ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/easymde', express.static(path.join(__dirname, 'node_modules/easymde/dist')));
app.use('/vendor/fullcalendar', express.static(path.join(__dirname, 'node_modules/fullcalendar')));
app.use('/vendor/font-awesome', express.static(path.join(__dirname, 'node_modules/font-awesome')));
app.use('/vendor/fonts/bricolage', express.static(path.join(__dirname, 'node_modules/@fontsource/bricolage-grotesque')));
app.use('/vendor/fonts/literata', express.static(path.join(__dirname, 'node_modules/@fontsource/literata')));

// ---------- Helpers ----------

// Turns "School/RIRS.md" into a full path and makes sure it stays inside DATA_DIR
function safePath(relPath) {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('Missing path');
  }
  if (!relPath.endsWith('.md')) {
    relPath = relPath + '.md';
  }
  const full = path.resolve(DATA_DIR, relPath);
  if (!full.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Path is outside the notes folder');
  }
  return full;
}

// Lists every .md file in DATA_DIR (including subfolders)
async function listNotes(dir = DATA_DIR) {
  let result = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden files like .git
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result = result.concat(await listNotes(full));
    } else if (entry.name.endsWith('.md')) {
      const stat = await fs.stat(full);
      result.push({
        path: path.relative(DATA_DIR, full).split(path.sep).join('/'),
        modified: stat.mtimeMs,
      });
    }
  }
  return result;
}

async function writeNote(full, content) {
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

// Wraps a route so errors become a JSON response instead of crashing
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.code === 'ENOENT' ? 404 : 400;
      res.status(status).json({ error: err.code === 'ENOENT' ? 'Note not found' : err.message });
    }
  };
}

// ---------- Notes API ----------

app.get('/api/notes', handle(async (req, res) => {
  const notes = await listNotes();
  notes.sort((a, b) => a.path.localeCompare(b.path));
  res.json(notes);
}));

app.get('/api/note', handle(async (req, res) => {
  const content = await fs.readFile(safePath(req.query.path), 'utf8');
  res.json({ path: req.query.path, content: content });
}));

// Create a new note (fails if it already exists)
app.post('/api/note', handle(async (req, res) => {
  const full = safePath(req.body.path);
  const exists = await fs.stat(full).then(() => true).catch(() => false);
  if (exists) {
    return res.status(409).json({ error: 'A note with that name already exists' });
  }
  await writeNote(full, req.body.content || '');
  res.json({ ok: true });
}));

// Save a note
app.put('/api/note', handle(async (req, res) => {
  await writeNote(safePath(req.query.path), req.body.content || '');
  res.json({ ok: true });
}));

app.delete('/api/note', handle(async (req, res) => {
  await fs.unlink(safePath(req.query.path));
  res.json({ ok: true });
}));

app.post('/api/rename', handle(async (req, res) => {
  const from = safePath(req.body.from);
  const to = safePath(req.body.to);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  res.json({ ok: true });
}));

app.get('/api/search', handle(async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const results = [];
  if (q.length < 2) return res.json(results);

  for (const note of await listNotes()) {
    const content = await fs.readFile(safePath(note.path), 'utf8');
    const index = content.toLowerCase().indexOf(q);
    if (index !== -1 || note.path.toLowerCase().includes(q)) {
      const start = Math.max(0, index - 40);
      results.push({
        path: note.path,
        snippet: index === -1 ? '' : content.slice(start, index + q.length + 60).replace(/\n/g, ' '),
      });
    }
  }
  res.json(results);
}));

// ---------- Tasks & events API ----------

app.get('/api/items', handle(async (req, res) => {
  let items = [];
  for (const note of await listNotes()) {
    const content = await fs.readFile(safePath(note.path), 'utf8');
    items = items.concat(parseFile(note.path, content));
  }
  res.json(items);
}));

// Quick add: appends a task or event to the inbox note
app.post('/api/items', handle(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) throw new Error('Write what the task is first');

  let line = req.body.type === 'event' ? '- ' + text : '- [ ] ' + text;
  if (req.body.date) {
    line = setDate(line, req.body.date, req.body.time || null);
  }

  const full = safePath(INBOX_FILE);
  let content = await fs.readFile(full, 'utf8').catch(() => '# Inbox\n');
  if (!content.endsWith('\n')) content += '\n';
  await writeNote(full, content + line + '\n');
  res.json({ ok: true });
}));

// Update one task/event line: tick it off, or move it to another date
app.patch('/api/items', handle(async (req, res) => {
  const full = safePath(req.body.path);
  const lines = (await fs.readFile(full, 'utf8')).split('\n');
  let line = lines[req.body.line];

  // Safety check: the file may have been edited since the page loaded
  if (line !== req.body.raw) {
    return res.status(409).json({ error: 'This note changed in the meantime. Reload and try again.' });
  }

  if (typeof req.body.done === 'boolean') {
    line = setDone(line, req.body.done);
  }
  if (req.body.date) {
    line = setDate(line, req.body.date, req.body.time || null);
  }

  lines[req.body.line] = line;
  await writeNote(full, lines.join('\n'));
  res.json({ ok: true, raw: line });
}));

// ---------- Start ----------

async function start() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const notes = await listNotes();
  if (notes.length === 0) {
    // First run: create a welcome note that shows the syntax
    await writeNote(safePath('Welcome.md'), [
      '# Welcome to Zvezek',
      '',
      'Notes are plain markdown files. Link to other notes with [[Inbox]].',
      '',
      '## Tasks',
      '- [ ] A task with a due date 📅 ' + new Date().toISOString().slice(0, 10),
      '- [ ] A task without a date',
      '- [x] A finished task',
      '',
      '## Events',
      '- Something happening at a time 📅 ' + new Date().toISOString().slice(0, 10) + ' 18:00',
      '',
    ].join('\n'));
  }
  app.listen(PORT, () => {
    console.log('Zvezek running on port ' + PORT + ', notes in ' + DATA_DIR);
  });
}

start();
