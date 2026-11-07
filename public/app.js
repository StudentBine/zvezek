// ================= Small helpers =================

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed (' + res.status + ')');
  }
  return data;
}

function toast(message, isError = false, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// "School/RIRS.md" -> "RIRS"
function noteName(path) {
  return path.split('/').pop().replace(/\.md$/, '');
}

// "School/RIRS.md" -> "School", "Inbox.md" -> ""
function noteFolder(path) {
  return path.split('/').slice(0, -1).join('/');
}

// Date as YYYY-MM-DD in local time
function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function isoTime(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function prettyDate(iso) {
  const date = new Date(iso + 'T00:00');
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// ================= State =================

let notes = [];          // list of { path, modified }
let items = [];          // tasks and events from all notes
let currentPath = null;  // note open in the editor
let saveTimer = null;
let dirty = false;
let calendar = null;
let currentView = 'notes';
let selected = new Set();   // notes ticked in the sidebar (Ctrl/Shift+click)
let anchorPath = null;      // where a Shift+click range starts

// ================= Notes list =================

async function loadNotes() {
  notes = await api('/api/notes');
  for (const path of Array.from(selected)) {
    if (!notes.some((n) => n.path === path)) selected.delete(path);
  }
  renderNoteList(notes);
  updateSelectBar();
}

// Groups notes by folder and draws them in the sidebar
function renderNoteList(list, snippets = {}) {
  const container = document.getElementById('note-list');
  container.innerHTML = '';

  const folders = {};
  for (const note of list) {
    const parts = note.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(note);
  }

  const folderNames = Object.keys(folders).sort((a, b) => {
    if (a === '') return -1; // notes without a folder go first
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  for (const folder of folderNames) {
    const ul = document.createElement('ul');

    for (const note of folders[folder]) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = noteName(note.path);
      btn.dataset.path = note.path;
      btn.className = 'note-link' + (note.path === currentPath ? ' current' : '') + (selected.has(note.path) ? ' selected' : '');
      btn.addEventListener('click', (e) => onNoteClick(e, note.path));
      li.appendChild(btn);

      if (snippets[note.path]) {
        const small = document.createElement('small');
        small.textContent = snippets[note.path];
        li.appendChild(small);
      }
      ul.appendChild(li);
    }

    if (folder === '') {
      container.appendChild(ul);
    } else {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = folder;
      details.appendChild(summary);
      details.appendChild(ul);
      container.appendChild(details);
    }
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="sidebar-empty">'
      + (document.getElementById('search').value.trim() ? 'No notes match your search.' : 'No notes yet. Use + to add one.')
      + '</p>';
  }
}

// ================= Editor =================

const editor = new EasyMDE({
  element: document.getElementById('editor'),
  spellChecker: false,
  status: false,
  tabSize: 4,              // nested lists are indented with 4 spaces
  indentWithTabs: false,
  autoDownloadFontAwesome: false, // icons are served locally from /vendor/font-awesome
  placeholder: 'Start writing. Add a task with  - [ ] something 📅 2026-11-20',
  // Grouped: text style | lists and tasks | insert | view
  toolbar: [
    'bold', 'italic', 'heading', '|',
    'unordered-list', 'ordered-list',
    { name: 'task', action: insertTask, className: 'fa fa-check-square-o', title: 'Insert task' },
    '|', 'link', 'quote', 'code', '|',
    'preview', 'side-by-side',
  ],
  // Turn [[Note name]] into clickable links in the preview
  previewRender: (text) => {
    const withLinks = text.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
      return '<a href="#" class="wikilink" data-note="' + name.replace(/"/g, '') + '">' + name + '</a>';
    });
    return fixImagePaths(editor.markdown(withLinks));
  },
});

// Images: ![](pic.png) or ![](Folder/my%20pic.png) are relative to the folder of the open note.
// They are served by the backend at /files/<path>.
function fixImagePaths(html) {
  const box = document.createElement('template');   // a template does not load images
  box.innerHTML = html;
  const base = currentPath ? noteFolder(currentPath).split('/').filter(Boolean) : [];

  box.content.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return;   // http:, data:, /absolute

    let decoded = src.split('#')[0].split('?')[0];
    try { decoded = decodeURIComponent(decoded); } catch (err) { /* keep it as it is */ }

    const parts = base.slice();
    for (const part of decoded.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    img.setAttribute('src', '/files/' + parts.map(encodeURIComponent).join('/'));
    img.setAttribute('loading', 'lazy');
  });
  return box.innerHTML;
}

function insertTask() {
  const cm = editor.codemirror;
  cm.replaceSelection('- [ ] ');
  cm.focus();
}

// ---------- Numbered lists: Tab, Shift+Tab and Enter (see lists.js) ----------

// Writes the result of a list operation back into the editor
function applyListResult(cm, result) {
  cm.operation(() => {
    if (result.lines.length !== result.count) {
      // A line was added or removed (Enter): replace the whole block
      const lastLine = result.first + result.count - 1;
      cm.replaceRange(result.lines.join('\n'), { line: result.first, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
      return;
    }
    // Same number of lines (Tab, Shift+Tab): only touch the lines that changed
    result.lines.forEach((text, k) => {
      const lineNo = result.first + k;
      const old = cm.getLine(lineNo);
      if (old !== text) cm.replaceRange(text, { line: lineNo, ch: 0 }, { line: lineNo, ch: old.length });
    });
  });
}

// Line numbers touched by the selection(s)
function selectedRows(cm) {
  const rows = new Set();
  for (const sel of cm.listSelections()) {
    const from = sel.from();
    const to = sel.to();
    const last = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
    for (let i = from.line; i <= last; i++) rows.add(i);
  }
  return Array.from(rows);
}

function onTab(cm, direction) {
  const rows = selectedRows(cm);
  const lines = cm.getValue().split('\n');
  // Bullets, tasks and plain text keep the normal behaviour
  if (!rows.some((r) => ListTools.isNumbered(lines[r]))) {
    cm.execCommand(direction > 0 ? 'tabAndIndentMarkdownList' : 'shiftTabAndUnindentMarkdownList');
    return;
  }

  const result = ListTools.shift(lines, rows, direction);
  if (!result) return;   // e.g. Tab on the first item: nothing to nest under
  const oldLengths = result.lines.map((_, k) => lines[result.first + k].length);
  const sels = cm.listSelections();
  applyListResult(cm, result);

  // Keep the cursor on the same text even though the line got longer or shorter
  const moved = (pos) => {
    const k = pos.line - result.first;
    if (k < 0 || k >= result.lines.length) return pos;
    return { line: pos.line, ch: Math.max(0, pos.ch + result.lines[k].length - oldLengths[k]) };
  };
  cm.setSelections(sels.map((s) => ({ anchor: moved(s.anchor), head: moved(s.head) })));
}

function onEnter(cm) {
  if (!cm.somethingSelected()) {
    const cursor = cm.getCursor();
    const result = ListTools.enter(cm.getValue().split('\n'), cursor.line, cursor.ch);
    if (result) {
      applyListResult(cm, result);
      cm.setCursor(result.cursor);
      return;
    }
  }
  cm.execCommand('newlineAndIndentContinueMarkdownList');
}

editor.codemirror.setOption('extraKeys', Object.assign({}, editor.codemirror.getOption('extraKeys'), {
  'Tab': (cm) => onTab(cm, 1),
  'Shift-Tab': (cm) => onTab(cm, -1),
  'Enter': onEnter,
}));

editor.codemirror.on('change', (cm, change) => {
  if (change.origin === 'setValue') return; // loading a note is not an edit
  dirty = true;
  setSaveState('Unsaved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 800);
});

// Clicking a [[wiki link]] in preview mode
document.querySelector('.editor-wrap').addEventListener('click', async (e) => {
  const link = e.target.closest('.wikilink');
  if (!link) return;
  e.preventDefault();
  const name = link.dataset.note;
  const found = notes.find((n) => noteName(n.path).toLowerCase() === name.toLowerCase());
  if (found) {
    openNote(found.path);
  } else {
    await createNote(name + '.md');
  }
});

function setSaveState(text) {
  const el = document.getElementById('save-state');
  el.textContent = text;
  el.dataset.state = text.toLowerCase().replace(' ', '-');
}

async function saveNote() {
  if (!currentPath || !dirty) return;
  clearTimeout(saveTimer);
  try {
    await api('/api/note?path=' + encodeURIComponent(currentPath), {
      method: 'PUT',
      body: { content: editor.value() },
    });
    dirty = false;
    setSaveState('Saved');
  } catch (err) {
    setSaveState('Not saved');
    toast(err.message, true);
  }
}

async function openNote(path) {
  await saveNote();
  try {
    const data = await api('/api/note?path=' + encodeURIComponent(path));
    currentPath = path;
    localStorage.setItem('lastNote', path);
    if (editor.isPreviewActive()) editor.togglePreview(); // the preview would still show the old note
    editor.value(data.content);
    dirty = false;
    setSaveState('');
    document.getElementById('note-title').value = path.replace(/\.md$/, '');
    showNoteEditor(true);
    showView('notes');
    renderNoteList(notes);
    document.body.classList.remove('menu-open');
  } catch (err) {
    toast(err.message, true);
  }
}

// The server may rewrite a note when it moves (image links), so load the file again.
// Without this, the next autosave would write the old text back.
async function reloadOpenNote() {
  if (!currentPath) return;
  try {
    const data = await api('/api/note?path=' + encodeURIComponent(currentPath));
    if (data.content === editor.value()) return;
    const inPreview = editor.isPreviewActive();
    if (inPreview) editor.togglePreview();
    editor.value(data.content);
    if (inPreview) editor.togglePreview();   // draw the preview again with the new text
  } catch (err) {
    toast(err.message, true);
  }
}

function showNoteEditor(show) {
  document.querySelector('#view-notes .view-head').hidden = !show;
  document.querySelector('.editor-wrap').hidden = !show;
  document.getElementById('empty-notes').hidden = show;
  if (show) editor.codemirror.refresh();
}

async function createNote(path) {
  try {
    await api('/api/note', { method: 'POST', body: { path: path, content: '# ' + noteName(path) + '\n\n' } });
    await loadNotes();
    await openNote(path.endsWith('.md') ? path : path + '.md');
  } catch (err) {
    toast(err.message, true);
  }
}

document.getElementById('new-note').addEventListener('click', newNote);
document.getElementById('empty-new').addEventListener('click', newNote);

async function newNote() {
  // A folder can be part of the name: "School/RIRS"
  let base = 'Untitled';
  let n = 1;
  while (notes.some((note) => note.path === base + '.md')) {
    n++;
    base = 'Untitled ' + n;
  }
  await createNote(base + '.md');
  const title = document.getElementById('note-title');
  title.focus();
  title.select();
}

// Rename: edit the title field and press Enter (or click away)
const titleInput = document.getElementById('note-title');
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') titleInput.blur();
  if (e.key === 'Escape') {
    titleInput.value = currentPath.replace(/\.md$/, '');
    titleInput.blur();
  }
});
titleInput.addEventListener('blur', async () => {
  const newPath = titleInput.value.trim() + '.md';
  if (!currentPath || newPath === currentPath || newPath === '.md') {
    titleInput.value = currentPath ? currentPath.replace(/\.md$/, '') : '';
    return;
  }
  try {
    await saveNote();
    await api('/api/rename', { method: 'POST', body: { from: currentPath, to: newPath } });
    currentPath = newPath;
    localStorage.setItem('lastNote', newPath);
    await loadNotes();
    await reloadOpenNote();
    toast('Renamed');
  } catch (err) {
    titleInput.value = currentPath.replace(/\.md$/, '');
    toast(err.message, true);
  }
});

document.getElementById('delete-note').addEventListener('click', async () => {
  if (!currentPath) return;
  if (!confirm('Delete "' + noteName(currentPath) + '"? This cannot be undone.')) return;
  try {
    await api('/api/note?path=' + encodeURIComponent(currentPath), { method: 'DELETE' });
    currentPath = null;
    dirty = false;
    localStorage.removeItem('lastNote');
    showNoteEditor(false);
    await loadNotes();
    toast('Deleted');
  } catch (err) {
    toast(err.message, true);
  }
});

// ================= Selecting several notes =================

// Paths in the order the sidebar shows them (notes inside closed folders are skipped)
function visiblePaths() {
  return Array.from(document.querySelectorAll('#note-list .note-link'))
    .filter((btn) => btn.offsetParent !== null)
    .map((btn) => btn.dataset.path);
}

function onNoteClick(e, path) {
  const toggle = e.ctrlKey || e.metaKey;

  if (e.shiftKey) {
    // Range from the last clicked note (or the open note) to this one
    const order = visiblePaths();
    const from = order.indexOf(anchorPath || currentPath);
    const to = order.indexOf(path);
    const start = from === -1 ? to : Math.min(from, to);
    const end = from === -1 ? to : Math.max(from, to);
    if (!toggle) selected.clear();
    for (let i = start; i <= end; i++) selected.add(order[i]);
  } else if (toggle) {
    if (selected.has(path)) selected.delete(path);
    else selected.add(path);
    anchorPath = path;
  } else {
    // Plain click: open the note and forget the selection
    selected.clear();
    anchorPath = path;
    updateSelectBar();
    openNote(path);
    return;
  }
  updateSelectBar();
}

function clearSelection() {
  selected.clear();
  anchorPath = null;
  updateSelectBar();
}

// Marks selected notes and shows the action bar when 2 or more are selected
function updateSelectBar() {
  document.querySelectorAll('#note-list .note-link').forEach((btn) => {
    btn.classList.toggle('selected', selected.has(btn.dataset.path));
  });
  const bar = document.getElementById('select-bar');
  bar.hidden = selected.size < 2;
  document.getElementById('select-count').textContent = selected.size + ' selected';
}

// After a move or delete: reload the list and forget the selection
async function afterBulkChange() {
  clearSelection();
  await loadNotes();
  loadItems().catch(() => {});   // task paths changed too
}

document.getElementById('select-clear').addEventListener('click', clearSelection);

// ---------- Delete ----------

document.getElementById('select-delete').addEventListener('click', async () => {
  const paths = Array.from(selected);
  if (paths.length < 2) return;
  if (!confirm('Delete ' + paths.length + ' notes? This cannot be undone.')) return;

  try {
    await saveNote();   // do not lose edits of the open note
    const result = await api('/api/notes/delete', { method: 'POST', body: { paths: paths } });

    if (currentPath && result.deleted.includes(currentPath)) {
      currentPath = null;
      dirty = false;
      localStorage.removeItem('lastNote');
      showNoteEditor(false);
    }
    await afterBulkChange();

    if (result.failed.length) {
      toast('Deleted ' + result.deleted.length + ', ' + result.failed.length + ' failed: '
        + result.failed.map((f) => noteName(f.path) + ' (' + f.error + ')').join(', '), true, 8000);
    } else {
      toast('Deleted ' + result.deleted.length + ' notes');
    }
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Move ----------

const moveDialog = document.getElementById('move-dialog');
const moveSelect = document.getElementById('move-folder');
const moveNew = document.getElementById('move-new');

// Every folder that exists, including the parents of nested ones ("A/B" gives "A" and "A/B")
function allFolders() {
  const folders = new Set();
  for (const note of notes) {
    const parts = noteFolder(note.path).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

function addOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

document.getElementById('select-move').addEventListener('click', () => {
  moveSelect.innerHTML = '';
  addOption(moveSelect, '', 'Top level (no folder)');
  for (const folder of allFolders()) addOption(moveSelect, 'f:' + folder, folder);
  addOption(moveSelect, '__new__', 'New folder…');

  document.getElementById('move-title').textContent = 'Move ' + selected.size + ' notes';
  document.getElementById('move-new-wrap').hidden = true;
  moveNew.value = '';
  moveDialog.showModal();
  moveSelect.focus();
});

moveSelect.addEventListener('change', () => {
  const isNew = moveSelect.value === '__new__';
  document.getElementById('move-new-wrap').hidden = !isNew;
  if (isNew) moveNew.focus();
});

document.getElementById('move-cancel').addEventListener('click', () => moveDialog.close());

document.getElementById('move-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  let folder = moveSelect.value.startsWith('f:') ? moveSelect.value.slice(2) : '';
  if (moveSelect.value === '__new__') {
    folder = moveNew.value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!folder) {
      toast('Type a name for the new folder', true);
      moveNew.focus();
      return;
    }
  }

  const paths = Array.from(selected);
  try {
    await saveNote();
    const result = await api('/api/notes/move', { method: 'POST', body: { paths: paths, folder: folder } });
    moveDialog.close();

    // The open note stays open, at its new path
    for (const m of result.moved) {
      if (m.from === currentPath) {
        currentPath = m.to;
        localStorage.setItem('lastNote', m.to);
        document.getElementById('note-title').value = m.to.replace(/\.md$/, '');
      }
    }
    await afterBulkChange();
    await reloadOpenNote();

    const where = folder || 'the top level';
    if (result.failed.length) {
      toast('Moved ' + result.moved.length + ' to ' + where + '. Not moved: '
        + result.failed.map((f) => noteName(f.path) + ' (' + f.error + ')').join(', '), true, 8000);
    } else {
      toast('Moved ' + result.moved.length + ' notes to ' + where);
    }
  } catch (err) {
    toast(err.message, true);
  }
});

// ================= Sidebar: hide and resize =================

const rootEl = document.documentElement;
const sidebar = document.getElementById('sidebar');
const resizer = document.getElementById('sidebar-resizer');
const desktop = window.matchMedia('(min-width: 801px)');
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch (err) { /* not important */ }
}

// The editor and calendar measure their size, so tell them when the space changes
function refreshLayout() {
  editor.codemirror.refresh();
  if (calendar) calendar.updateSize();
}

function setSidebarWidth(px, save = true) {
  px = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
  rootEl.style.setProperty('--sidebar-w', px + 'px');
  resizer.setAttribute('aria-valuenow', px);
  if (save) remember('sidebarWidth', px);
  refreshLayout();
}

function isCollapsed() {
  return rootEl.classList.contains('sidebar-collapsed');
}

// A hidden sidebar must not be reachable with Tab (only on desktop; on a phone it is the drawer)
function syncSidebarInert() {
  sidebar.inert = isCollapsed() && desktop.matches;
}

function setSidebarCollapsed(collapsed) {
  rootEl.classList.add('sidebar-animating');     // animation only for hide and show, not for dragging
  rootEl.classList.toggle('sidebar-collapsed', collapsed);
  syncSidebarInert();
  remember('sidebarCollapsed', collapsed ? '1' : '0');
  refreshLayout();
  setTimeout(() => {
    rootEl.classList.remove('sidebar-animating');
    refreshLayout();
  }, 240);
}

document.getElementById('collapse-sidebar').addEventListener('click', () => {
  setSidebarCollapsed(true);
  document.getElementById('expand-sidebar').focus();
});
document.getElementById('expand-sidebar').addEventListener('click', () => {
  setSidebarCollapsed(false);
  document.getElementById('collapse-sidebar').focus();
});

// Ctrl+\ (Cmd+\ on a Mac)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    e.preventDefault();
    if (desktop.matches) setSidebarCollapsed(!isCollapsed());
  }
});

// Drag the right edge
resizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  rootEl.classList.remove('sidebar-animating');
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
});
resizer.addEventListener('pointermove', (e) => {
  if (!resizer.hasPointerCapture(e.pointerId)) return;
  setSidebarWidth(e.clientX, false);
});
resizer.addEventListener('pointerup', (e) => {
  resizer.releasePointerCapture(e.pointerId);
  document.body.classList.remove('resizing');
  setSidebarWidth(e.clientX);   // this one is saved
});
resizer.addEventListener('dblclick', () => setSidebarWidth(DEFAULT_WIDTH));

// Arrow keys when the edge has focus (Shift = bigger steps)
resizer.addEventListener('keydown', (e) => {
  const current = sidebar.getBoundingClientRect().width;
  const step = e.shiftKey ? 48 : 16;
  if (e.key === 'ArrowLeft') setSidebarWidth(current - step);
  else if (e.key === 'ArrowRight') setSidebarWidth(current + step);
  else if (e.key === 'Home') setSidebarWidth(MIN_WIDTH);
  else if (e.key === 'End') setSidebarWidth(MAX_WIDTH);
  else return;
  e.preventDefault();
});

desktop.addEventListener('change', syncSidebarInert);
syncSidebarInert();
resizer.setAttribute('aria-valuenow', Math.round(sidebar.getBoundingClientRect().width));

// ================= Search =================

let searchTimer = null;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(async () => {
    if (q.length < 2) {
      renderNoteList(notes);
      return;
    }
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    const snippets = {};
    for (const r of results) snippets[r.path] = r.snippet;
    renderNoteList(results.map((r) => ({ path: r.path })), snippets);
  }, 250);
});

// ================= Tasks & events =================

async function loadItems() {
  items = await api('/api/items');
  updateOverdueBadge();
}

// Small marigold number next to "Tasks" when something is overdue
function updateOverdueBadge() {
  const today = isoDate(new Date());
  const count = items.filter((i) => i.type === 'task' && !i.done && i.date && i.date < today).length;
  const badge = document.getElementById('overdue-badge');
  badge.textContent = count;
  badge.hidden = count === 0;
  badge.title = count + ' overdue';
}

async function updateItem(item, changes) {
  try {
    const result = await api('/api/items', {
      method: 'PATCH',
      body: { path: item.path, line: item.line, raw: item.raw, ...changes },
    });
    item.raw = result.raw;
    if (typeof changes.done === 'boolean') item.done = changes.done;
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function refreshItems() {
  await loadItems();
  if (currentView === 'calendar') calendar.refetchEvents();
  if (currentView === 'tasks') renderTasks();
}

// ---------- Calendar ----------

function itemToEvent(item, index) {
  const event = {
    id: String(index),
    title: item.title,
    allDay: !item.time,
    start: item.time ? item.date + 'T' + item.time.padStart(5, '0') : item.date,
    classNames: [item.type, item.done ? 'done' : 'open'],
    extendedProps: { item: item },
  };
  if (item.type === 'task' && !item.done && item.date < isoDate(new Date())) {
    event.classNames.push('overdue');
  }
  return event;
}

function setupCalendar() {
  calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    initialView: localStorage.getItem('calendarView') || 'dayGridMonth',
    firstDay: 1,
    height: '100%',
    editable: true,
    eventStartEditable: true,
    eventDurationEditable: false,
    dayMaxEvents: 4,
    nowIndicator: true,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
    buttonText: { today: 'Today', month: 'Month', week: 'Week', list: 'List' },

    events: (info, success) => {
      success(items.filter((item) => item.date).map(itemToEvent));
    },

    datesSet: (info) => localStorage.setItem('calendarView', info.view.type),

    // Draw a checkbox in front of tasks
    eventContent: (arg) => {
      const item = arg.event.extendedProps.item;
      const wrap = document.createElement('div');
      wrap.className = 'ev';
      if (item.type === 'task') {
        const box = document.createElement('span');
        box.className = 'box';
        box.title = item.done ? 'Mark as not done' : 'Mark as done';
        wrap.appendChild(box);
      } else if (arg.timeText) {
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = arg.timeText;
        wrap.appendChild(time);
      }
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = arg.event.title;
      wrap.appendChild(title);
      return { domNodes: [wrap] };
    },

    // Click the box to tick it off, anywhere else to open the note
    eventClick: async (info) => {
      info.jsEvent.preventDefault();
      const item = info.event.extendedProps.item;
      if (info.jsEvent.target.classList.contains('box')) {
        if (await updateItem(item, { done: !item.done })) {
          calendar.refetchEvents();
        }
      } else {
        openNote(item.path);
      }
    },

    // Drag to another day: the date in the markdown file changes too
    eventDrop: async (info) => {
      const item = info.event.extendedProps.item;
      const start = info.event.start;
      const time = info.event.allDay ? null : isoTime(start);
      const ok = await updateItem(item, { date: isoDate(start), time: time });
      if (ok) {
        item.date = isoDate(start);
        item.time = time;
        toast('Moved to ' + prettyDate(item.date));
      } else {
        info.revert();
      }
    },

    dateClick: (info) => {
      openAddDialog(isoDate(info.date), info.allDay ? '' : isoTime(info.date));
    },
  });
  calendar.render();
}

// ---------- Task list ----------

function renderTasks() {
  const today = isoDate(new Date());
  const inAWeek = isoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  const groups = [
    { name: 'Overdue', className: 'overdue', list: [] },
    { name: 'Today', className: 'today', list: [] },
    { name: 'Next 7 days', className: '', list: [] },
    { name: 'Later', className: '', list: [] },
    { name: 'No date', className: '', list: [] },
    { name: 'Done', className: 'done-group', list: [] },
  ];

  for (const item of items) {
    if (item.type !== 'task') continue;
    if (item.done) groups[5].list.push(item);
    else if (!item.date) groups[4].list.push(item);
    else if (item.date < today) groups[0].list.push(item);
    else if (item.date === today) groups[1].list.push(item);
    else if (item.date <= inAWeek) groups[2].list.push(item);
    else groups[3].list.push(item);
  }

  const container = document.getElementById('task-groups');
  container.innerHTML = '';
  let total = 0;

  for (const group of groups) {
    if (group.list.length === 0) continue;
    total += group.list.length;
    group.list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const section = document.createElement(group.name === 'Done' ? 'details' : 'section');
    section.className = 'task-group ' + group.className;

    const heading = document.createElement(group.name === 'Done' ? 'summary' : 'h2');
    heading.innerHTML = group.name + ' <span class="count">' + group.list.length + '</span>';
    section.appendChild(heading);

    const ul = document.createElement('ul');
    for (const item of group.list.slice(0, group.name === 'Done' ? 30 : 500)) {
      ul.appendChild(taskRow(item));
    }
    section.appendChild(ul);
    container.appendChild(section);
  }

  if (total === 0) {
    container.innerHTML = '<div class="empty">'
      + '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M2 38 20 10l10 15 8-10 24 23Z"/><circle cx="50" cy="8" r="4"/></svg>'
      + '<h2>All clear</h2>'
      + '<p>Write <code>- [ ] something</code> in any note and it shows up here.</p>'
      + '</div>';
  }
}

function taskRow(item) {
  const li = document.createElement('li');
  li.className = 'task-row' + (item.done ? ' done' : '');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = item.done;
  box.setAttribute('aria-label', 'Done: ' + item.title);
  box.addEventListener('change', async () => {
    if (await updateItem(item, { done: box.checked })) {
      li.classList.toggle('done', box.checked);
      setTimeout(renderTasks, 500); // short pause so you can see the tick
    } else {
      box.checked = !box.checked;
    }
  });

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = item.title;

  const meta = document.createElement('span');
  meta.className = 'task-meta';
  if (item.date) {
    const date = document.createElement('span');
    date.className = 'chip';
    date.textContent = prettyDate(item.date) + (item.time ? ' ' + item.time : '');
    meta.appendChild(date);
  }
  const link = document.createElement('button');
  link.className = 'from-note';
  link.textContent = noteName(item.path);
  link.title = 'Open ' + item.path;
  link.addEventListener('click', () => openNote(item.path));
  meta.appendChild(link);

  li.append(box, title, meta);
  return li;
}

// ---------- Quick add dialog ----------

const dialog = document.getElementById('add-dialog');
const addForm = document.getElementById('add-form');

function openAddDialog(date = '', time = '') {
  addForm.reset();
  addForm.date.value = date;
  addForm.time.value = time;
  dialog.showModal();
  addForm.text.focus();
}

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => openAddDialog(isoDate(new Date())));
});
document.getElementById('add-cancel').addEventListener('click', () => dialog.close());

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/items', {
      method: 'POST',
      body: {
        text: addForm.text.value,
        type: addForm.type.value,
        date: addForm.date.value,
        time: addForm.time.value,
      },
    });
    dialog.close();
    toast('Added to Inbox');
    await loadNotes();
    await refreshItems();
  } catch (err) {
    toast(err.message, true);
  }
});

// ================= Switching views =================

async function showView(name) {
  if (name === currentView && name !== 'notes') return;
  const leavingNotes = currentView === 'notes' && name !== 'notes';
  currentView = name;

  document.querySelectorAll('[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === name);
    if (b.dataset.view === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.body.dataset.view = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.body.classList.remove('menu-open');

  if (leavingNotes) await saveNote();

  if (name === 'calendar') {
    await loadItems();
    if (!calendar) setupCalendar();
    else {
      calendar.updateSize();
      calendar.refetchEvents();
    }
  }
  if (name === 'tasks') {
    await loadItems();
    renderTasks();
  }
}

document.querySelectorAll('button[data-view]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const view = btn.dataset.view;
    // Coming back to notes: reload the note in case a task was ticked elsewhere
    if (view === 'notes' && currentPath && currentView !== 'notes') {
      currentView = 'notes';
      await openNote(currentPath);
    } else {
      showView(view);
    }
  });
});

document.getElementById('menu-toggle').addEventListener('click', () => {
  document.body.classList.toggle('menu-open');
});
document.getElementById('scrim').addEventListener('click', () => {
  document.body.classList.remove('menu-open');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.body.classList.remove('menu-open');
  if (selected.size && !document.querySelector('dialog[open]')) clearSelection();
});

// Save before closing the tab
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    saveNote();
    e.preventDefault();
  }
});

// Ctrl+S saves right away
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveNote();
  }
});

// ================= Start =================

async function start() {
  document.body.dataset.view = 'notes';
  loadItems().catch(() => {}); // only for the overdue badge
  await loadNotes();
  const last = localStorage.getItem('lastNote');
  const first = notes.find((n) => n.path === last) || notes[0];
  if (first) {
    await openNote(first.path);
  } else {
    showNoteEditor(false);
  }
}

start();
