const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { constants: fsConstants } = require('fs');
const { parseFile, setDate, completeTask, reopenTask, repeatOf, occurrences, isRealDate, addDays } = require('./parser');
const { rewriteImageLinks } = require('./links');

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
app.use('/vendor/mermaid', express.static(path.join(__dirname, 'node_modules/mermaid/dist')));
app.use('/vendor/fonts/bricolage', express.static(path.join(__dirname, 'node_modules/@fontsource/bricolage-grotesque')));
app.use('/vendor/fonts/literata', express.static(path.join(__dirname, 'node_modules/@fontsource/literata')));

// ---------- Other files (images in notes) ----------
// /files/School/pic.png is DATA_DIR/School/pic.png. Notes (.md), hidden files and
// anything outside DATA_DIR are not served.
app.get('/files/*filePath', (req, res) => {
  const parts = req.params.filePath;
  try {
    if (parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) {
      throw new Error('Not allowed');
    }
    const rel = parts.join('/');
    if (rel.toLowerCase().endsWith('.md')) throw new Error('Not allowed');
    const full = safeFile(rel);
    // "sandbox" stops scripts in an SVG or HTML file from running if someone opens it directly.
    // It is not set for other files, because it would stop the browser from showing PDFs.
    if (/\.(svgz?|html?|xhtml|xml)$/i.test(rel)) res.set('Content-Security-Policy', 'sandbox');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(full, { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).send('Not found');
    });
  } catch (err) {
    res.status(404).send('Not found');
  }
});

// ---------- Helpers ----------

// Turns a relative path into a full path and makes sure it stays inside DATA_DIR
function safeFile(relPath) {
  if (!relPath || typeof relPath !== 'string' || relPath.includes('\0')) {
    throw new Error('Missing path');
  }
  const full = path.resolve(DATA_DIR, relPath);
  if (!full.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Path is outside the notes folder');
  }
  return full;
}

// Same for notes: "School/RIRS" becomes ".../School/RIRS.md"
function safePath(relPath) {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('Missing path');
  }
  if (!relPath.endsWith('.md')) {
    relPath = relPath + '.md';
  }
  return safeFile(relPath);
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

// What kind of file is this? Used for the icon in the sidebar.
function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.md') return 'note';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico'].includes(ext)) return 'image';
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz'].includes(ext)) return 'archive';
  return 'other';
}

// Lists every file in DATA_DIR (notes and all other files), skipping hidden ones.
// Symlinks to other files are skipped, so nothing outside DATA_DIR is listed.
async function listAllFiles(dir = DATA_DIR) {
  let result = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result = result.concat(await listAllFiles(full));
    } else if (entry.name.endsWith('.md') || entry.isFile()) {
      const stat = await fs.stat(full);
      result.push({ path: relPath(full), modified: stat.mtimeMs, size: stat.size, kind: kindOf(entry.name) });
    }
  }
  return result;
}

// A path for any file: notes get ".md" handled like before, other files must not be hidden
function entryPath(rel) {
  if (typeof rel === 'string' && rel.endsWith('.md')) return safePath(rel);
  if (typeof rel === 'string' && rel.split('/').some((part) => part === '..' || part.startsWith('.'))) {
    throw new Error('Path is not allowed');
  }
  return safeFile(rel);
}

async function writeNote(full, content) {
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

function relPath(full) {
  return path.relative(DATA_DIR, full).split(path.sep).join('/');
}

function conflictError(rel) {
  const what = rel.endsWith('.md') ? 'A note named "' + rel.replace(/\.md$/, '') + '"' : 'A file named "' + rel + '"';
  const err = new Error(what + ' already exists');
  err.status = 409;
  return err;
}

// Moves or renames one note. Never overwrites an existing note.
// When the folder changes, relative image links inside the note are rewritten so they
// still point at the same files (the image files are not moved).
async function moveNote(fromRel, toRel) {
  const from = safePath(fromRel);
  const to = safePath(toRel);
  if (from === to) return;

  const fromInfo = await fs.stat(from);                       // missing note: ENOENT -> 404
  const toInfo = await fs.stat(to).catch(() => null);

  if (toInfo) {
    // On a case-insensitive file system "rirs.md" and "RIRS.md" are the same file.
    // Then this is only a change of letters, not a conflict.
    const sameFile = toInfo.ino === fromInfo.ino && toInfo.dev === fromInfo.dev;
    if (!sameFile) throw conflictError(relPath(to));
    // A direct rename does nothing there (same file), so go through a temporary hidden name
    const temp = path.join(path.dirname(from), '.zvezek-rename-' + Date.now());
    await fs.rename(from, temp);
    await fs.rename(temp, to).catch(async (err) => {
      await fs.rename(temp, from).catch(() => {});             // put it back
      throw err;
    });
    await fs.unlink(temp).catch(() => {});                       // only exists if the second rename did nothing
    return;
  }

  const content = await fs.readFile(from, 'utf8');
  const fixed = rewriteImageLinks(content, path.posix.dirname(relPath(from)).replace(/^\.$/, ''), path.posix.dirname(relPath(to)).replace(/^\.$/, ''));
  await fs.mkdir(path.dirname(to), { recursive: true });
  // flag "wx" fails if the file appeared in the meantime, so nothing is ever overwritten
  await fs.writeFile(to, fixed, { encoding: 'utf8', flag: 'wx' }).catch((err) => {
    if (err.code === 'EEXIST') throw conflictError(relPath(to));
    throw err;
  });
  await fs.unlink(from);
  await removeEmptyFolders(path.dirname(from));
}

// Removes a folder (and its parents) if they are empty, but never DATA_DIR itself
async function removeEmptyFolders(dir) {
  while (dir !== DATA_DIR && dir.startsWith(DATA_DIR + path.sep)) {
    const removed = await fs.rmdir(dir).then(() => true).catch(() => false);
    if (!removed) break;
    dir = path.dirname(dir);
  }
}

// Moves any other file (pdf, image, zip ...). Never overwrites. Nothing inside is changed.
async function moveFile(fromRel, toRel) {
  const from = entryPath(fromRel);
  const to = entryPath(toRel);
  if (from === to) return;
  await fs.stat(from);
  await fs.mkdir(path.dirname(to), { recursive: true });
  // COPYFILE_EXCL fails instead of overwriting an existing file
  await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL).catch((err) => {
    if (err.code === 'EEXIST') throw conflictError(relPath(to));
    throw err;
  });
  await fs.unlink(from);
  await removeEmptyFolders(path.dirname(from));
}

// Wraps a route so errors become a JSON response instead of crashing
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || (err.code === 'ENOENT' ? 404 : 400);
      res.status(status).json({ error: err.code === 'ENOENT' ? 'Note not found' : err.message });
    }
  };
}

// ---------- Notes API ----------

app.get('/api/notes', handle(async (req, res) => {
  const notes = await listAllFiles();
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
  await moveNote(req.body.from, req.body.to);
  res.json({ ok: true });
}));

// Move several notes into one folder ("" = top level).
// Never overwrites: a note whose name already exists there is reported in "failed".
app.post('/api/notes/move', handle(async (req, res) => {
  const paths = req.body.paths;
  const folder = (req.body.folder || '').trim().replace(/^\/+|\/+$/g, '');
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No notes selected');
  if (typeof req.body.folder !== 'string' && req.body.folder !== undefined) throw new Error('Folder must be text');
  if (folder.split('/').some((part) => part === '..' || part.startsWith('.'))) throw new Error('Invalid folder name');

  const moved = [];
  const failed = [];
  for (const rel of paths) {
    try {
      const from = entryPath(rel);
      const to = entryPath(folder ? folder + '/' + path.basename(from) : path.basename(from));
      if (from === to) throw new Error('already in that folder');
      if (from.endsWith('.md')) await moveNote(relPath(from), relPath(to));
      else await moveFile(relPath(from), relPath(to));
      moved.push({ from: relPath(from), to: relPath(to) });
    } catch (err) {
      failed.push({ path: String(rel), error: err.code === 'ENOENT' ? 'not found' : err.message });
    }
  }
  res.json({ moved: moved, failed: failed });
}));

// Delete several notes at once
app.post('/api/notes/delete', handle(async (req, res) => {
  const paths = req.body.paths;
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No notes selected');

  const deleted = [];
  const failed = [];
  for (const rel of paths) {
    try {
      const full = entryPath(rel);
      await fs.unlink(full);
      await removeEmptyFolders(path.dirname(full));
      deleted.push(relPath(full));
    } catch (err) {
      failed.push({ path: String(rel), error: err.code === 'ENOENT' ? 'not found' : err.message });
    }
  }
  res.json({ deleted: deleted, failed: failed });
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
        kind: 'note',
        snippet: index === -1 ? '' : content.slice(start, index + q.length + 60).replace(/\n/g, ' '),
      });
    }
  }

  // Other files (pdf, zip, images ...) match on their name only
  for (const file of await listAllFiles()) {
    if (file.kind !== 'note' && file.path.toLowerCase().includes(q)) {
      results.push({ path: file.path, kind: file.kind, snippet: '', size: file.size });
    }
  }
  res.json(results);
}));

// ---------- Tasks & events API ----------

// With ?from=YYYY-MM-DD&to=YYYY-MM-DD, repeating items also get "occurrences": the other dates
// of the series inside that range. Events: all of them. Open tasks: only the next 3.
app.get('/api/items', handle(async (req, res) => {
  let items = [];
  for (const note of await listNotes()) {
    const content = await fs.readFile(safePath(note.path), 'utf8');
    items = items.concat(parseFile(note.path, content));
  }

  const { from, to } = req.query;
  if (from !== undefined || to !== undefined) {
    if (!isRealDate(from) || !isRealDate(to)) throw new Error('from and to must be dates (YYYY-MM-DD)');
    for (const item of items) {
      if (!item.repeat || (item.type === 'task' && item.done)) continue;
      const info = repeatOf(item.raw);
      if (!info) continue;
      let dates;
      if (item.type === 'event') {
        dates = occurrences(info.rule, info.date, from, to);
      } else {
        dates = occurrences(info.rule, info.date, addDays(info.date, 1), '9999-12-31', 3)
          .filter((date) => date >= from && date <= to);
      }
      item.occurrences = dates.filter((date) => date !== info.date);
    }
  }
  res.json(items);
}));

// Repeat choices of the Add dialog, in Obsidian Tasks wording
const REPEAT_CHOICES = {
  daily: 'every day',
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
  weekdays: 'every weekday',
};

// Quick add: appends a task or event to the inbox note
app.post('/api/items', handle(async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) throw new Error('Write what the task is first');

  let line = req.body.type === 'event' ? '- ' + text : '- [ ] ' + text;

  // Repeat: the Obsidian Tasks text goes before the date ("... 🔁 every week 📅 2026-11-09")
  const repeat = req.body.repeat || 'none';
  if (repeat !== 'none') {
    if (!REPEAT_CHOICES[repeat]) throw new Error('Unknown repeat option');
    if (!req.body.date) throw new Error('Pick a date for a repeating item');
    line += ' 🔁 ' + REPEAT_CHOICES[repeat];
  }
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

  // The ticked line, and for a repeating task also a new open line above it (see parser.js)
  let newLines = [line];
  if (typeof req.body.done === 'boolean') {
    const item = parseFile(req.body.path, line)[0];
    if (req.body.done && item && item.type === 'task' && !item.done) {
      const today = isRealDate(req.body.today) ? req.body.today : new Date().toISOString().slice(0, 10);
      newLines = completeTask(line, today);
    } else if (!req.body.done) {
      newLines = [reopenTask(line)];
    }
  }
  if (req.body.date) {
    const last = newLines.length - 1;
    newLines[last] = setDate(newLines[last], req.body.date, req.body.time || null);
  }

  lines.splice(req.body.line, 1, ...newLines);
  await writeNote(full, lines.join('\n'));
  res.json({ ok: true, raw: newLines[newLines.length - 1], inserted: newLines.length - 1 });
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
