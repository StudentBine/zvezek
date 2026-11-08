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

// 1536 -> "1.5 KB"
function prettySize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
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

// "Thu 12 Nov" (with the year when it is not this year). The same text is used everywhere (see dates.js).
function prettyDate(iso) {
  return DateChips.dateText(iso);
}

// ================= State =================

let entries = [];        // every file in the notes folder: { path, modified, size, kind }
let notes = [];          // only the notes (kind "note"), the ones that open in the editor
let items = [];          // tasks and events from all notes
let currentPath = null;  // note open in the editor
let saveTimer = null;
let dirty = false;
let calendar = null;
let currentView = 'notes';
let selected = new Set();   // notes ticked in the sidebar (Ctrl/Shift+click)
let anchorPath = null;      // where a Shift+click range starts
let settings = { showInbox: true, inbox: 'Inbox.md' };   // saved on the server (see "Settings" below)

// ================= Notes list =================

async function loadNotes() {
  entries = await api('/api/notes');
  notes = entries.filter((e) => e.kind === 'note');
  for (const path of Array.from(selected)) {
    if (!entries.some((e) => e.path === path)) selected.delete(path);
  }
  renderNoteList(visibleEntries());
  updateSelectBar();
}

// The sidebar list without the Inbox when "Show Inbox in sidebar" is off (search still finds it)
function visibleEntries() {
  return settings.showInbox ? entries : entries.filter((e) => e.path !== settings.inbox);
}

// Small icons for files that are not notes
const FILE_ICONS = {
  pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><text x="12.5" y="17.3" font-size="6.2" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">PDF</text>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  archive: '<path d="M4 8h16v12H4z"/><path d="M3 4h18v4H3zM10 12h4"/>',
  other: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
};

// A file that is not a note: opens /files/<path> in a new browser tab
function fileLink(file) {
  const link = document.createElement('a');
  link.className = 'note-link file-link' + (selected.has(file.path) ? ' selected' : '');
  link.dataset.path = file.path;
  link.dataset.kind = file.kind;
  link.href = '/files/' + file.path.split('/').map(encodeURIComponent).join('/');
  link.target = '_blank';
  link.rel = 'noopener';
  const name = file.path.split('/').pop();
  link.title = name + (typeof file.size === 'number' ? ' (' + prettySize(file.size) + ')' : '');
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (FILE_ICONS[file.kind] || FILE_ICONS.other) + '</svg>';
  const label = document.createElement('span');
  label.textContent = name;
  link.appendChild(label);

  link.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();          // selecting, not opening
      onNoteClick(e, file.path);
    } else {
      selected.clear();            // plain click: the browser opens the file in a new tab
      anchorPath = file.path;
      updateSelectBar();
    }
  });
  return link;
}

// Groups notes and files by folder and draws them in the sidebar.
// list: { path, kind, size? }. In each folder the notes come first, then the other files.
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
    const inFolder = folders[folder];
    const ordered = inFolder.filter((n) => n.kind === 'note').concat(inFolder.filter((n) => n.kind !== 'note'));

    for (const note of ordered) {
      const li = document.createElement('li');

      if (note.kind === 'note') {
        const btn = document.createElement('button');
        btn.textContent = noteName(note.path);
        btn.dataset.path = note.path;
        btn.className = 'note-link' + (note.path === currentPath ? ' current' : '') + (selected.has(note.path) ? ' selected' : '');
        btn.addEventListener('click', (e) => onNoteClick(e, note.path));
        li.appendChild(btn);
      } else {
        li.appendChild(fileLink(note));
      }

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
      + (document.getElementById('search').value.trim() ? 'Nothing matches your search.' : 'No notes yet. Use + to add one.')
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
  sideBySideFullscreen: false,   // side by side stays inside the page; it never takes over the screen
  placeholder: 'Start writing. Add a task with  - [ ] something due:2026-11-20',
  // Grouped: text style | lists and tasks | insert | view
  toolbar: [
    'bold', 'italic', 'heading', '|',
    'unordered-list', 'ordered-list',
    { name: 'task', action: insertTask, className: 'fa fa-check-square-o', title: 'Insert task' },
    '|', 'link', 'quote', 'code', 'table', 'horizontal-rule', '|',
    'preview', 'side-by-side',
  ],
  // Turn [[Note name]] into clickable links in the preview
  previewRender: (text, preview) => {
    const withLinks = text.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
      return '<a href="#" class="wikilink" data-note="' + name.replace(/"/g, '') + '">' + name + '</a>';
    });
    const html = preparePreview(editor.markdown(withLinks));
    // Diagrams are drawn right after EasyMDE has put this html on the page
    if (preview) setTimeout(() => drawDiagrams(preview), 0);
    return html;
  },
});

// Changes the html that marked made, before it is shown:
// - images: ![](pic.png) or ![](Folder/my%20pic.png) are relative to the folder of the open note
//   and are served by the backend at /files/<path>
// - tables get a wrapper, so a wide table scrolls sideways instead of overflowing
// - ```mermaid blocks become a box that drawDiagrams() fills with the diagram
function preparePreview(html) {
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

  box.content.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });

  box.content.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
    const holder = document.createElement('div');
    holder.className = 'mermaid-box';
    holder.dataset.source = code.textContent;
    const done = diagramResults[diagramKey(code.textContent)];
    if (done) fillDiagramBox(holder, done);     // drawn before: no flicker while typing
    else holder.textContent = 'Drawing diagram…';
    code.parentElement.replaceWith(holder);
  });

  markPreviewDates(box.content);
  return box.innerHTML;
}

// Dates in list items become quiet chips: "due:2026-11-12 14:00" shows as "Thu 12 Nov, 14:00"
function markPreviewDates(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest('code, pre') || !parent.closest('li')) continue;
    const found = DateChips.find(node.nodeValue);
    if (found.length === 0) continue;

    const checkbox = parent.closest('li').querySelector(':scope > input[type=checkbox]');
    const open = !checkbox || !checkbox.checked;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const chip of found) {
      fragment.append(node.nodeValue.slice(at, chip.from));
      fragment.append(chipElement(chip, open));
      at = chip.to;
    }
    fragment.append(node.nodeValue.slice(at));
    node.replaceWith(fragment);
  }
}

// One chip: just text. Open tasks that are due today or late get the marigold colour.
function chipElement(chip, open) {
  const el = document.createElement('span');
  el.className = 'date-chip ' + chip.kind;
  if (chip.kind === 'due' && open) {
    const state = DateChips.state(chip.date);
    if (state) el.classList.add(state);
  }
  el.textContent = chip.label;
  return el;
}

// ---------- Mermaid diagrams ----------
// The library (about 5 MB) is only loaded the first time a note has a diagram.

let mermaidLoading = null;
function loadMermaid() {
  if (!mermaidLoading) {
    mermaidLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/mermaid/mermaid.min.js';
      script.onload = resolve;
      script.onerror = () => { mermaidLoading = null; reject(new Error('Could not load the diagram library')); };
      document.head.appendChild(script);
    });
  }
  return mermaidLoading;
}

function isDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Colours of the Pohorje palette, for light and dark
function mermaidTheme() {
  const font = '"Bricolage Grotesque", system-ui, sans-serif';
  if (isDark()) {
    return {
      fontFamily: font, background: '#1D2321', mainBkg: '#2B4A40', primaryColor: '#2B4A40', primaryTextColor: '#E4E8E5',
      primaryBorderColor: '#8DAA80', lineColor: '#98A39D', secondaryColor: '#26332B', tertiaryColor: '#1D2321',
      textColor: '#E4E8E5', nodeTextColor: '#E4E8E5', noteBkgColor: '#26332B', noteTextColor: '#E4E8E5', noteBorderColor: '#8DAA80',
      actorBkg: '#2B4A40', actorBorder: '#8DAA80', actorTextColor: '#E4E8E5', actorLineColor: '#98A39D', signalColor: '#E4E8E5',
      signalTextColor: '#E4E8E5', labelBoxBkgColor: '#26332B', labelBoxBorderColor: '#8DAA80', labelTextColor: '#E4E8E5',
      loopTextColor: '#E4E8E5', activationBkgColor: '#26332B', activationBorderColor: '#8DAA80', edgeLabelBackground: '#1D2321',
      clusterBkg: '#26332B', clusterBorder: '#2F3834', titleColor: '#E4E8E5',
    };
  }
  return {
    fontFamily: font, background: '#FFFFFF', mainBkg: '#CFE0D8', primaryColor: '#CFE0D8', primaryTextColor: '#2E3236',
    primaryBorderColor: '#234B3F', lineColor: '#6F7A74', secondaryColor: '#E3ECDF', tertiaryColor: '#F6F7F5',
    textColor: '#2E3236', nodeTextColor: '#2E3236', noteBkgColor: '#E3ECDF', noteTextColor: '#2E3236', noteBorderColor: '#5F7D54',
    actorBkg: '#CFE0D8', actorBorder: '#234B3F', actorTextColor: '#2E3236', actorLineColor: '#6F7A74', signalColor: '#2E3236',
    signalTextColor: '#2E3236', labelBoxBkgColor: '#E3ECDF', labelBoxBorderColor: '#234B3F', labelTextColor: '#2E3236',
    loopTextColor: '#2E3236', activationBkgColor: '#E3ECDF', activationBorderColor: '#234B3F', edgeLabelBackground: '#FFFFFF',
    clusterBkg: '#F6F7F5', clusterBorder: '#DDE3DE', titleColor: '#2E3236',
  };
}

const diagramResults = {};      // finished diagrams: { svg } or { error }, so they are not drawn twice
const diagramJobs = {};         // diagrams being drawn right now
let diagramQueue = Promise.resolve();   // mermaid draws one diagram at a time
let diagramCount = 0;

function diagramKey(source) {
  return (isDark() ? 'dark' : 'light') + '\n' + source;
}

// Draws one diagram (or finds out why it is broken)
function drawOne(source, key) {
  const id = 'mermaid-' + (++diagramCount);
  return loadMermaid()
    .then(() => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: mermaidTheme(), suppressErrorRendering: true });
      return mermaid.render(id, source);
    })
    .then((result) => ({ svg: result.svg }))
    .catch((err) => {
      const leftover = document.getElementById('d' + id);   // mermaid may leave an error drawing in the page
      if (leftover) leftover.remove();
      const first = String((err && err.message) || err).split('\n')[0].trim();
      return { error: first.length > 140 ? first.slice(0, 140) + '…' : first };
    })
    .then((result) => {
      diagramResults[key] = result;
      return result;
    });
}

function fillDiagramBox(box, result) {
  box.className = 'mermaid-box';
  box.textContent = '';
  if (result.svg) {
    box.innerHTML = result.svg;
    box.dataset.state = 'done';
    return;
  }
  // A broken diagram: a short message, and the source so it can be fixed
  box.classList.add('mermaid-error');
  box.dataset.state = 'error';
  const message = document.createElement('p');
  const label = document.createElement('strong');
  label.textContent = 'Diagram error: ';
  message.append(label, document.createTextNode(result.error));
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = box.dataset.source;
  pre.appendChild(code);
  box.append(message, pre);
}

// Fills every diagram box inside "root" (the preview element)
async function drawDiagrams(root) {
  const boxes = Array.from(root.querySelectorAll('.mermaid-box')).filter((b) => !b.dataset.state);
  for (const box of boxes) {
    const source = box.dataset.source;
    const key = diagramKey(source);
    if (!diagramJobs[key]) {
      diagramJobs[key] = diagramQueue = diagramQueue.then(() => diagramResults[key] || drawOne(source, key));
    }
    const result = await diagramJobs[key];
    if (box.isConnected) fillDiagramBox(box, result);
  }
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

// ---------- Dates in the editor ----------
// Away from the cursor, "due:2026-11-12 14:00" is drawn as the chip "Thu 12 Nov, 14:00".
// The file is not changed: the chip only hides the text. The line with the cursor shows the real text.

let dateMarks = [];

function markEditorDates(cm) {
  cm.operation(() => {
    for (const mark of dateMarks) mark.clear();
    dateMarks = [];

    const busy = new Set();     // lines with the cursor or a selection
    for (const sel of cm.listSelections()) {
      for (let i = sel.from().line; i <= sel.to().line; i++) busy.add(i);
    }

    let inFence = false;
    cm.eachLine((handle) => {
      const text = handle.text;
      const line = cm.getLineNumber(handle);
      if (/^\s*(```|~~~)/.test(text)) { inFence = !inFence; return; }
      if (inFence || busy.has(line)) return;
      if (!/^\s*(?:[-*]|\d+[.)]) /.test(text)) return;          // only list items, like the parser

      const open = !/^\s*(?:[-*]|\d+[.)]) \[[xX]\]/.test(text);
      for (const chip of DateChips.find(text)) {
        dateMarks.push(cm.markText({ line: line, ch: chip.from }, { line: line, ch: chip.to }, {
          replacedWith: chipElement(chip, open),
        }));
      }
    });
  });
}

editor.codemirror.on('cursorActivity', markEditorDates);
editor.codemirror.on('change', markEditorDates);

// ---------- Closing brackets and quotes ----------
// ( [ { " ' ` add their partner. With text selected they wrap it. Typing the partner when it is
// already next to the cursor only moves past it. Backspace right after an opener removes an empty pair.

const Pass = editor.codemirror.constructor.Pass;   // "let the editor handle this key as usual"
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const QUOTES = ['"', "'", '`'];
const isWordChar = (c) => /[\p{L}\p{N}_]/u.test(c || '');

function typeCharacter(cm, ch) {
  if (cm.listSelections().length !== 1) return Pass;

  if (cm.somethingSelected()) {
    if (!PAIRS[ch]) return Pass;
    const from = cm.getCursor('from');
    const text = cm.getSelection();
    cm.replaceSelection(ch + text + PAIRS[ch], 'around');
    const to = cm.getCursor('to');
    // keep the original text selected, inside the new pair
    cm.setSelection(
      { line: from.line, ch: from.ch + 1 },
      { line: to.line, ch: to.ch - 1 });
    return;
  }

  const cursor = cm.getCursor();
  const line = cm.getLine(cursor.line);
  const before = line.charAt(cursor.ch - 1);
  const next = line.charAt(cursor.ch);

  // The partner is already there: move past it
  if (next === ch && (QUOTES.includes(ch) || ch === PAIRS['('] || ch === PAIRS['['] || ch === PAIRS['{'])) {
    cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
    return;
  }
  if (!PAIRS[ch]) return Pass;

  // Not in the middle of a word (don't, it's) and not in front of one
  if (QUOTES.includes(ch) && isWordChar(before)) return Pass;
  if (isWordChar(next)) return Pass;
  // Typing ``` for a code fence: the third backtick comes after two
  if (ch === '`' && before === '`') return Pass;

  cm.replaceSelection(ch + PAIRS[ch]);
  cm.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
}

function backspaceInPair(cm) {
  if (cm.somethingSelected() || cm.listSelections().length !== 1) return Pass;
  const cursor = cm.getCursor();
  const line = cm.getLine(cursor.line);
  const open = line.charAt(cursor.ch - 1);
  if (PAIRS[open] && line.charAt(cursor.ch) === PAIRS[open]) {
    cm.replaceRange('', { line: cursor.line, ch: cursor.ch - 1 }, { line: cursor.line, ch: cursor.ch + 1 });
    return;
  }
  return Pass;
}

const bracketKeys = { 'Backspace': backspaceInPair };
for (const ch of Object.keys(PAIRS).concat([')', ']', '}'])) {
  bracketKeys["'" + ch + "'"] = (cm) => typeCharacter(cm, ch);
}
editor.codemirror.addKeyMap(bracketKeys);

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

let saveStateText = '';

function setSaveState(text) {
  const el = document.getElementById('save-state');
  el.textContent = text;
  el.dataset.state = text.toLowerCase().replace(' ', '-');
  saveStateText = text;
  updateTabDots();
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

// ================= Tabs =================
// Every open note is a tab. There is still only one editor: switching tabs saves the note,
// loads the other one and puts the cursor and scroll position back where they were.

let tabs = [];   // [{ path, cursor, scroll }] in the order shown

function tabFor(path) {
  return tabs.find((t) => t.path === path);
}

// Cursor and scroll position of the open note, so they can be restored later
function rememberTab() {
  const tab = tabFor(currentPath);
  if (!tab) return;
  tab.cursor = editor.codemirror.getCursor();
  tab.scroll = editor.codemirror.getScrollInfo();
}

function saveTabs() {
  try {
    localStorage.setItem('tabs', JSON.stringify(tabs.map((t) => t.path)));
    if (currentPath) localStorage.setItem('lastNote', currentPath);
    else localStorage.removeItem('lastNote');
  } catch (err) { /* private mode: tabs just are not remembered */ }
}

// "RIRS", or "School/RIRS" when another open tab has the same name
function tabLabel(path) {
  const name = noteName(path);
  const clash = tabs.some((t) => t.path !== path && noteName(t.path) === name);
  return clash ? path.replace(/\.md$/, '') : name;
}

// The dot on the tab of the note with unsaved changes
function updateTabDots() {
  const unsaved = saveStateText === 'Unsaved' || saveStateText === 'Not saved';
  document.querySelectorAll('#tabs .tab').forEach((el) => {
    el.classList.toggle('unsaved', unsaved && el.dataset.path === currentPath);
  });
}

let draggedTab = null;

function clearDropMarks() {
  document.querySelectorAll('#tabs .drop-before, #tabs .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

function renderTabs() {
  const bar = document.getElementById('tabs');
  bar.innerHTML = '';
  bar.hidden = tabs.length === 0;

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.path === currentPath ? ' active' : '');
    el.dataset.path = tab.path;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', tab.path === currentPath ? 'true' : 'false');
    el.tabIndex = 0;
    el.draggable = true;
    el.title = tab.path.replace(/\.md$/, '');

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tabLabel(tab.path);
    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.title = 'Unsaved changes';
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.setAttribute('aria-label', 'Close ' + noteName(tab.path));
    close.title = 'Close (Alt+W)';
    close.textContent = '×';
    el.append(label, dot, close);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      if (tab.path !== currentPath) openNote(tab.path);
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
        e.preventDefault();
        if (tab.path !== currentPath) openNote(tab.path);
      }
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.path);
    });
    // Middle click closes (mousedown is stopped so the browser does not start auto-scroll)
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tab.path);
      }
    });

    // Drag to reorder
    el.addEventListener('dragstart', (e) => {
      draggedTab = tab.path;
      e.dataTransfer.effectAllowed = 'move';
      // a custom type, so dropping a tab on the editor does not paste its name
      e.dataTransfer.setData('application/x-zvezek-tab', tab.path);
      el.classList.add('dragging');
    });
    el.addEventListener('dragover', (e) => {
      if (!draggedTab) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      clearDropMarks();
      if (tab.path !== draggedTab) el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', (e) => {
      if (!draggedTab) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      moveTab(draggedTab, tab.path, after);
    });
    el.addEventListener('dragend', () => {
      draggedTab = null;
      clearDropMarks();
      el.classList.remove('dragging');
    });

    bar.appendChild(el);
  }

  updateTabDots();
  const active = bar.querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  bar.scrollTop = 0;                // the strip only ever scrolls sideways
  updateTabFades();
}

// The tab strip has no scrollbar. When tabs do not fit, the edge that hides more tabs fades out,
// and the mouse wheel scrolls it sideways.
function updateTabFades() {
  const bar = document.getElementById('tabs');
  const room = bar.scrollWidth - bar.clientWidth;
  bar.classList.toggle('fade-left', room > 4 && bar.scrollLeft > 2);
  bar.classList.toggle('fade-right', room > 4 && bar.scrollLeft < room - 2);
}
document.getElementById('tabs').addEventListener('scroll', updateTabFades);
window.addEventListener('resize', updateTabFades);
document.getElementById('tabs').addEventListener('wheel', (e) => {
  const bar = e.currentTarget;
  if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault();               // a normal mouse wheel only goes up and down
  bar.scrollLeft += e.deltaY;
}, { passive: false });

// Puts the tab "path" before or after the tab "targetPath"
function moveTab(path, targetPath, after) {
  const from = tabs.findIndex((t) => t.path === path);
  if (from === -1 || path === targetPath) return;
  const [moved] = tabs.splice(from, 1);
  const to = tabs.findIndex((t) => t.path === targetPath) + (after ? 1 : 0);
  tabs.splice(to, 0, moved);
  saveTabs();
  renderTabs();
}

// Closes a tab. Closing the open note saves it first and moves to the neighbour tab.
async function closeTab(path) {
  const index = tabs.findIndex((t) => t.path === path);
  if (index === -1) return;

  if (path !== currentPath) {
    tabs.splice(index, 1);
    saveTabs();
    renderTabs();
    return;
  }

  await saveNote();
  if (dirty && !confirm('"' + noteName(path) + '" could not be saved. Close it anyway?')) return;

  tabs.splice(index, 1);
  const next = tabs[index] || tabs[index - 1];
  if (next) {
    dirty = false;
    await openNote(next.path);
  } else {
    showNothingOpen();
  }
}

// No tab left: back to the empty state
function showNothingOpen() {
  currentPath = null;
  dirty = false;
  clearTimeout(saveTimer);
  setSaveState('');
  showNoteEditor(false);
  renderTabs();
  renderNoteList(visibleEntries());
  saveTabs();
}

// Notes were deleted (here or from the multi-select): close their tabs, no saving
async function forgetNotes(paths) {
  const gone = new Set(paths);
  const wasOpen = currentPath && gone.has(currentPath);
  const index = tabs.findIndex((t) => t.path === currentPath);

  tabs = tabs.filter((t) => !gone.has(t.path));
  if (!wasOpen) {
    saveTabs();
    renderTabs();
    return;
  }
  dirty = false;
  clearTimeout(saveTimer);
  const next = tabs[Math.min(index, tabs.length - 1)];
  if (next) await openNote(next.path);
  else showNothingOpen();
}

// Notes were renamed or moved: their tabs follow. changes = { "old/path.md": "new/path.md" }
function renameTabs(changes) {
  for (const tab of tabs) {
    if (changes[tab.path]) tab.path = changes[tab.path];
  }
  if (currentPath && changes[currentPath]) {
    currentPath = changes[currentPath];
    document.getElementById('note-title').value = currentPath.replace(/\.md$/, '');
  }
  saveTabs();
  renderTabs();
}

// Open a note (in its tab, or in a new one). quiet = do not move the keyboard focus.
async function openNote(path, quiet = false) {
  await saveNote();
  rememberTab();
  try {
    const data = await api('/api/note?path=' + encodeURIComponent(path));
    currentPath = path;
    if (!tabFor(path)) tabs.push({ path: path });
    const tab = tabFor(path);

    if (editor.isPreviewActive()) editor.togglePreview(); // the preview would still show the old note
    editor.value(data.content);
    dirty = false;
    setSaveState('');
    document.getElementById('note-title').value = path.replace(/\.md$/, '');
    showView('notes');
    showNoteEditor(true);

    // back where I was in this note
    const cm = editor.codemirror;
    if (tab.cursor) cm.setCursor(tab.cursor);
    if (tab.scroll) cm.scrollTo(tab.scroll.left, tab.scroll.top);
    if (!quiet && desktop.matches) cm.focus();

    renderTabs();
    saveTabs();
    renderNoteList(visibleEntries());
    document.body.classList.remove('menu-open');
  } catch (err) {
    toast(err.message, true);
    // a note that is gone should not stay as a tab
    if (/not found/i.test(err.message) && tabFor(path) && path !== currentPath) {
      tabs = tabs.filter((t) => t.path !== path);
      saveTabs();
      renderTabs();
    }
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
    renameTabs({ [currentPath]: newPath });
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
    const deletedPath = currentPath;
    await api('/api/note?path=' + encodeURIComponent(deletedPath), { method: 'DELETE' });
    await loadNotes();
    await forgetNotes([deletedPath]);
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
  const what = paths.every((p) => p.endsWith('.md')) ? 'notes' : 'items';
  if (!confirm('Delete ' + paths.length + ' ' + what + '? This cannot be undone.')) return;

  try {
    await saveNote();   // do not lose edits of the open note
    const result = await api('/api/notes/delete', { method: 'POST', body: { paths: paths } });

    await afterBulkChange();
    await forgetNotes(result.deleted);

    if (result.failed.length) {
      toast('Deleted ' + result.deleted.length + ', ' + result.failed.length + ' failed: '
        + result.failed.map((f) => noteName(f.path) + ' (' + f.error + ')').join(', '), true, 8000);
    } else {
      toast('Deleted ' + result.deleted.length + (result.deleted.every((p) => p.endsWith('.md')) ? ' notes' : ' items'));
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
  for (const note of entries) {
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

  document.getElementById('move-title').textContent = 'Move ' + selected.size + ' items';
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

    // Open notes (and their tabs) stay open, at their new path
    const changes = {};
    for (const m of result.moved) changes[m.from] = m.to;
    renameTabs(changes);
    await afterBulkChange();
    await reloadOpenNote();

    const where = folder || 'the top level';
    if (result.failed.length) {
      toast('Moved ' + result.moved.length + ' to ' + where + '. Not moved: '
        + result.failed.map((f) => noteName(f.path) + ' (' + f.error + ')').join(', '), true, 8000);
    } else {
      toast('Moved ' + result.moved.length + (result.moved.every((m) => m.to.endsWith('.md')) ? ' notes' : ' items') + ' to ' + where);
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
      renderNoteList(visibleEntries());
      return;
    }
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    const snippets = {};
    for (const r of results) snippets[r.path] = r.snippet;
    renderNoteList(results, snippets);
  }, 250);
});

// ================= Tasks & events =================

// Without a range: all tasks and events. With a range (YYYY-MM-DD): repeating items also come
// with "occurrences", the other dates of their series inside that range.
async function loadItems(from, to) {
  items = await api('/api/items' + (from ? '?from=' + from + '&to=' + to : ''));
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
      body: { path: item.path, line: item.line, raw: item.raw, today: isoDate(new Date()), ...changes },
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
  if (currentView === 'calendar') calendar.refetchEvents();   // loads the items itself
  else await loadItems();
  if (currentView === 'tasks') renderTasks();
}

// ---------- Calendar ----------

// "every week" or "every week until 2026-12-20", for tooltips and the Tasks view
function repeatText(item) {
  return item.repeat.text + (item.repeat.until ? ' until ' + prettyDate(item.repeat.until) : '');
}

function eventStart(item, date) {
  return item.time ? date + 'T' + item.time.padStart(5, '0') : date;
}

function itemToEvent(item, index) {
  const event = {
    id: String(index),
    title: item.title,
    allDay: !item.time,
    start: eventStart(item, item.date),
    classNames: [item.type, item.done ? 'done' : 'open'],
    extendedProps: { item: item },
  };
  if (item.type === 'task' && !item.done && item.date < isoDate(new Date())) {
    event.classNames.push('overdue');
  }
  return event;
}

// A later date of a repeating item: faded, cannot be clicked, dragged or ticked
function ghostEvent(item, index, date) {
  return {
    id: index + '-' + date,
    title: item.title,
    allDay: !item.time,
    start: eventStart(item, date),
    classNames: [item.type, 'open', 'ghost'],
    editable: false,
    extendedProps: { item: item, ghost: true },
  };
}

function buildEvents() {
  const events = [];
  items.forEach((item, index) => {
    if (!item.date) return;
    events.push(itemToEvent(item, index));
    for (const date of item.occurrences || []) events.push(ghostEvent(item, index, date));
  });
  return events;
}

// The week view shows 06:00-24:00. Earlier items would be hidden, so the range grows for them.
function fitWeekHours(events) {
  let first = 6;
  for (const event of events) {
    if (!event.allDay) first = Math.min(first, parseInt(event.start.slice(11, 13), 10));
  }
  const want = String(first).padStart(2, '0') + ':00:00';
  if (calendar.getOption('slotMinTime') !== want) calendar.setOption('slotMinTime', want);
}

function setupCalendar() {
  calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
    initialView: localStorage.getItem('calendarView') || 'dayGridMonth',
    firstDay: 1,
    height: 'auto',               // the calendar is as tall as its content: no scrollbars inside it
    editable: true,
    eventStartEditable: true,
    eventDurationEditable: false,
    dayMaxEvents: 8,              // "+N more" only for a really busy day
    nowIndicator: true,
    slotMinTime: '06:00:00',
    slotMaxTime: '24:00:00',
    slotDuration: '01:00:00',
    snapDuration: '00:15:00',     // dragging still snaps to 15 minutes
    views: { timeGridWeek: { dayMaxEvents: false } },   // the all-day row grows instead
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
    buttonText: { today: 'Today', month: 'Month', week: 'Week', list: 'List' },

    // Loads the items for the dates on screen (repeating items come with their dates)
    events: async (info, success, failure) => {
      try {
        const last = new Date(info.end);
        last.setDate(last.getDate() - 1);          // info.end is the day after the last visible day
        await loadItems(isoDate(info.start), isoDate(last));
        const events = buildEvents();
        success(events);
        setTimeout(() => fitWeekHours(events), 0);
      } catch (err) {
        failure(err);
        toast(err.message, true);
      }
    },

    datesSet: (info) => localStorage.setItem('calendarView', info.view.type),

    // Tasks get a round checkbox, events show their time in bold. Repeating items say so in the tooltip.
    eventContent: (arg) => {
      const item = arg.event.extendedProps.item;
      const ghost = arg.event.extendedProps.ghost;
      const wrap = document.createElement('div');
      wrap.className = 'ev';
      if (item.repeat) wrap.title = 'Repeats ' + repeatText(item);
      if (item.type === 'task') {
        const box = document.createElement('span');
        box.className = 'box';
        box.title = ghost ? 'Comes after you tick the task before it' : (item.done ? 'Mark as not done' : 'Mark as done');
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

    // Click the box to tick it off, anywhere else to open the note. Faded copies do nothing.
    eventClick: async (info) => {
      info.jsEvent.preventDefault();
      if (info.event.extendedProps.ghost) return;
      const item = info.event.extendedProps.item;
      if (info.jsEvent.target.classList.contains('box')) {
        if (await updateItem(item, { done: !item.done })) {
          calendar.refetchEvents();    // a repeating task gets a new line, so load everything again
        }
      } else {
        openNote(item.path);
      }
    },

    // Drag to another day: the date in the markdown file changes too.
    // For a repeating item that moves the whole series (the due: date).
    eventDrop: async (info) => {
      const item = info.event.extendedProps.item;
      const start = info.event.start;
      const time = info.event.allDay ? null : isoTime(start);
      const ok = await updateItem(item, { date: isoDate(start), time: time });
      if (ok) {
        item.date = isoDate(start);
        item.time = time;
        toast(item.repeat ? 'Series moved to ' + prettyDate(item.date) : 'Moved to ' + prettyDate(item.date));
        if (item.repeat) calendar.refetchEvents();   // the faded copies move too
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
      await loadItems();            // a repeating task gets a new line, so load everything again
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
  if (item.repeat) {
    const repeats = document.createElement('span');
    repeats.className = 'repeat-text';
    repeats.textContent = 'repeats ' + repeatText(item);
    meta.appendChild(repeats);
  }
  if (item.date) {
    const date = document.createElement('span');
    date.className = 'chip';
    date.textContent = DateChips.dueText(item.date, item.time);
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
  if (addForm.repeat.value !== 'none' && !addForm.date.value) {
    toast('Pick a date for a repeating item', true);
    addForm.date.focus();
    return;
  }
  try {
    await api('/api/items', {
      method: 'POST',
      body: {
        text: addForm.text.value,
        type: addForm.type.value,
        date: addForm.date.value,
        time: addForm.time.value,
        repeat: addForm.repeat.value,
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
// Tabs: Alt+PageUp / Alt+PageDown switch, Alt+W closes.
// (Alt+Left/Right would clash with the editor, where they jump to the start/end of a line,
// and with "back" in the browser. Ctrl+Tab and Ctrl+W belong to the browser.)
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || currentView !== 'notes' || tabs.length === 0) return;

  if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    const step = e.key === 'PageDown' ? 1 : -1;
    const index = tabs.findIndex((t) => t.path === currentPath);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next && next.path !== currentPath) openNote(next.path);
  } else if (e.code === 'KeyW' && currentPath) {
    e.preventDefault();
    closeTab(currentPath);
  }
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

// ================= Settings =================

const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');

document.getElementById('open-settings').addEventListener('click', () => {
  settingsForm.showInbox.checked = settings.showInbox;
  document.getElementById('inbox-hint').textContent = 'Quick add still writes to ' + settings.inbox
    + '. When it is hidden here, you can still find it with search.';
  settingsDialog.showModal();
  document.body.classList.remove('menu-open');
});

// Saved as soon as the box is clicked
settingsForm.showInbox.addEventListener('change', async () => {
  const wanted = settingsForm.showInbox.checked;
  try {
    settings = await api('/api/settings', { method: 'PUT', body: { showInbox: wanted } });
    renderNoteList(visibleEntries());
  } catch (err) {
    settingsForm.showInbox.checked = settings.showInbox;
    toast(err.message, true);
  }
});

// ================= Start =================

async function start() {
  document.body.dataset.view = 'notes';
  settings = await api('/api/settings').catch(() => settings);
  loadItems().catch(() => {}); // only for the overdue badge
  await loadNotes();

  // Open tabs from last time (only notes that still exist)
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('tabs') || '[]'); } catch (err) { /* ignore */ }
  const last = localStorage.getItem('lastNote');
  if (!Array.isArray(saved) || saved.length === 0) saved = last ? [last] : [];
  tabs = saved.filter((p) => typeof p === 'string' && notes.some((n) => n.path === p)).map((p) => ({ path: p }));

  const first = tabs.find((t) => t.path === last) || tabs[0] || (notes[0] ? { path: notes[0].path } : null);
  if (first) {
    await openNote(first.path, true);
  } else {
    showNoteEditor(false);
    renderTabs();
  }
}

start();
