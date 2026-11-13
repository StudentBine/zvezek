// ================= Small helpers =================

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed (' + res.status + ')');
    err.status = res.status;
    err.data = data;
    throw err;
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
let settings = { showInbox: true, inbox: 'Inbox.md', livePreview: true, wideEditor: false, showHidden: false, maxFileMB: 25, categories: [], hidden: [], folderColors: {}, palette: [] };   // saved on the server (see "Settings" below)

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
  let list = settings.showInbox ? entries : entries.filter((e) => e.path !== settings.inbox);
  if (!settings.showHidden) list = list.filter((e) => !hiddenBy(e.path));
  return list;
}

// A hidden note, file or folder is gone from the sidebar (search and the calendar still see it).
// A hidden folder hides everything inside. Returns the entry of the hidden list that hides this path.
function hiddenBy(path) {
  return settings.hidden.find((h) => path === h || path.startsWith(h + '/')) || null;
}

async function reloadSettings() {
  settings = await api('/api/settings').catch(() => settings);   // the server may have moved hidden items and colours
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
  link.draggable = false;          // the row (li) is what gets dragged
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
      e.preventDefault();          // plain click: open it in a Zvezek tab
      selected.clear();
      anchorPath = file.path;
      updateSelectBar();
      openFile(file.path);
    }
  });
  return link;
}

// Groups notes and files by folder and draws them in the sidebar.
// list: { path, kind, size? }. In each folder the notes come first, then the other files.
function renderNoteList(list, snippets = {}) {
  const container = document.getElementById('note-list');
  container.innerHTML = '';

  // Folders are made from the paths of the files in them. Empty folders come as { kind: 'folder' }.
  const folders = {};
  for (const note of list) {
    const parts = note.path.split('/');
    const folder = note.kind === 'folder' ? note.path : parts.slice(0, -1).join('/');
    if (!folders[folder]) folders[folder] = [];
    if (note.kind !== 'folder') folders[folder].push(note);
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
      li.dataset.path = note.path;
      li.draggable = true;                       // drag onto a folder to move it
      if (hiddenBy(note.path)) li.classList.add('is-hidden');

      if (note.kind === 'note') {
        // A div that acts as a button: Firefox cannot start a drag from a real <button>
        const btn = document.createElement('div');
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.textContent = noteName(note.path);
        btn.dataset.path = note.path;
        btn.className = 'note-link' + (note.path === currentPath ? ' current' : '') + (selected.has(note.path) ? ' selected' : '');
        btn.addEventListener('click', (e) => onNoteClick(e, note.path));
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); } });
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
      details.dataset.folder = folder;
      if (hiddenBy(folder)) details.classList.add('is-hidden');

      const summary = document.createElement('summary');
      summary.dataset.folder = folder;
      summary.draggable = true;
      const colour = settings.folderColors[folder];
      if (colour) {
        summary.classList.add('cat-' + colour);
        summary.innerHTML = '<svg class="folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/></svg>';
      }
      const name = document.createElement('span');
      name.className = 'folder-name';
      name.textContent = folder;
      summary.appendChild(name);
      if (hiddenBy(folder)) {
        const mark = document.createElement('span');
        mark.className = 'hidden-mark';
        mark.textContent = 'hidden';
        summary.appendChild(mark);
      }
      details.appendChild(summary);

      // "Empty" only for a folder with nothing at all (a folder with subfolders is not empty)
      if (ordered.length === 0 && !folderNames.some((n) => n.startsWith(folder + '/'))) {
        const empty = document.createElement('div');
        empty.className = 'empty-folder';
        empty.textContent = 'Empty';
        details.appendChild(empty);
      }
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

// ---------- Folders: create, rename, delete, colour ----------

async function createFolder(path) {
  try {
    await api('/api/folders', { method: 'POST', body: { path: path } });
    await loadNotes();
    toast('Folder created');
  } catch (err) {
    toast(err.message, true);
  }
}

// parent = the folder to create it in ('' = top level)
function askNewFolder(parent = '') {
  const name = prompt(parent ? 'New folder inside "' + parent + '":' : 'New folder name (use / for a subfolder):');
  if (name && name.trim()) createFolder(parent ? parent + '/' + name.trim() : name.trim());
}

document.getElementById('new-folder').addEventListener('click', () => askNewFolder(''));

// Paths of the open tabs below a folder, as { old: new } for renameTabs()
function tabChangesForFolder(from, to) {
  const changes = {};
  for (const tab of tabs) {
    if (tab.path.startsWith(from + '/')) changes[tab.path] = to + tab.path.slice(from.length);
  }
  return changes;
}

// Rename a folder, or move it (to = its new full path). Notes inside keep their tabs.
async function renameFolder(from, to) {
  to = to.trim().replace(/^\/+|\/+$/g, '');
  if (!to || to === from) return;
  try {
    await saveNote();
    await api('/api/folders/rename', { method: 'POST', body: { from: from, to: to } });
    renameTabs(tabChangesForFolder(from, to));
    await reloadSettings();
    await loadNotes();
    loadItems().catch(() => {});
    await reloadOpenNote();
    toast('Moved "' + from + '" to "' + to + '"');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteFolder(path) {
  try {
    try {
      await api('/api/folders', { method: 'DELETE', body: { path: path } });
    } catch (err) {
      // A folder with files in it is only deleted after the answer "yes", which says how many files
      if (err.status !== 409 || !err.data || !err.data.count) throw err;
      if (!confirm(err.message + '. Delete the folder "' + path + '" and everything in it? This cannot be undone.')) return;
      await saveNote();
      await api('/api/folders', { method: 'DELETE', body: { path: path, force: true } });
    }
    await forgetNotes(tabs.map((t) => t.path).filter((p) => p.startsWith(path + '/')));
    await reloadSettings();
    await loadNotes();
    loadItems().catch(() => {});
    toast('Folder deleted');
  } catch (err) {
    toast(err.message, true);
  }
}

function setFolderColour(path, colour) {
  const colours = { ...settings.folderColors };
  if (colour) colours[path] = colour; else delete colours[path];
  saveSettings({ folderColors: colours });
}

// ---------- Hide notes, files and folders ----------

function hideItems(paths) {
  saveSettings({ hidden: Array.from(new Set(settings.hidden.concat(paths))) });
}

function unhideItems(paths) {
  saveSettings({ hidden: settings.hidden.filter((h) => !paths.includes(h)) });
}

document.getElementById('select-hide').addEventListener('click', () => {
  const paths = Array.from(selected);
  clearSelection();
  hideItems(paths);
  toast('Hidden ' + paths.length + ' items. Settings has the list to unhide them.');
});

// ---------- Right-click menu ----------

const menu = document.getElementById('context-menu');

function closeMenu() {
  menu.hidden = true;
}

function menuItem(label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', () => { closeMenu(); action(); });
  menu.appendChild(button);
}

function menuRule() {
  menu.appendChild(document.createElement('hr'));
}

function openMenu(e) {
  menu.hidden = false;
  const left = Math.max(8, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8));
  const top = Math.max(8, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  const first = menu.querySelector('button');
  if (first) first.focus();
}

// Hide / Unhide for one path (or for the whole selection when the path is part of it)
function menuHideItem(paths) {
  const direct = paths.filter((p) => settings.hidden.includes(p));
  if (direct.length === paths.length) menuItem('Unhide', () => unhideItems(paths));
  else if (paths.every((p) => hiddenBy(p))) menu.appendChild(Object.assign(document.createElement('p'), { className: 'menu-note', textContent: 'Hidden with its folder' }));
  else menuItem('Hide', () => hideItems(paths.filter((p) => !hiddenBy(p))));
}

document.getElementById('note-list').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menu.innerHTML = '';
  const summary = e.target.closest('summary[data-folder]');
  const row = e.target.closest('li[data-path]');

  if (summary) {
    const folder = summary.dataset.folder;
    menuItem('New subfolder…', () => askNewFolder(folder));
    menuItem('Rename or move…', () => {
      const to = prompt('New name or place for "' + folder + '":', folder);
      if (to) renameFolder(folder, to);
    });
    menuRule();
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'swatch none' + (settings.folderColors[folder] ? '' : ' on');
    none.title = 'No colour';
    none.addEventListener('click', () => { closeMenu(); setFolderColour(folder, null); });
    swatches.appendChild(none);
    for (const colour of settings.palette) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch cat-' + colour + (settings.folderColors[folder] === colour ? ' on' : '');
      dot.title = colour;
      dot.addEventListener('click', () => { closeMenu(); setFolderColour(folder, colour); });
      swatches.appendChild(dot);
    }
    menu.appendChild(swatches);
    menuRule();
    menuHideItem([folder]);
    menuItem('Delete folder…', () => deleteFolder(folder), 'danger');
  } else if (row) {
    const path = row.dataset.path;
    const paths = selected.has(path) && selected.size > 1 ? Array.from(selected) : [path];
    menuHideItem(paths);
  } else {
    menuItem('New folder…', () => askNewFolder(''));
  }
  openMenu(e);
});

document.addEventListener('mousedown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
document.getElementById('note-list').addEventListener('scroll', closeMenu);

// ---------- Drag and drop in the sidebar ----------
// Notes and files go onto a folder (or onto the empty part of the list = top level).
// A folder goes onto another folder. A dragged note that is part of a selection takes the whole selection.

let dragging = null;     // { paths: [...], folder: 'A/B' or null } while something is being dragged
const DRAG_TYPE = 'application/x-zvezek-items';
const noteListEl = document.getElementById('note-list');

noteListEl.addEventListener('dragstart', (e) => {
  const summary = e.target.closest && e.target.closest('summary[data-folder]');
  const row = e.target.closest && e.target.closest('li[data-path]');
  if (summary) {
    dragging = { paths: [], folder: summary.dataset.folder };
  } else if (row) {
    const path = row.dataset.path;
    dragging = { paths: selected.has(path) && selected.size > 1 ? Array.from(selected) : [path], folder: null };
  } else {
    return;
  }
  e.dataTransfer.setData(DRAG_TYPE, '1');
  e.dataTransfer.effectAllowed = 'move';
});

function clearDropTargets() {
  noteListEl.classList.remove('drop-root');
  noteListEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
}

// Which folder is under the mouse? '' = the top level
function folderUnder(e) {
  const details = e.target.closest && e.target.closest('details[data-folder]');
  return details ? details.dataset.folder : '';
}

// A folder cannot go into itself or into its own subfolders, and moving it where it already is does nothing
function canDropOn(folder) {
  if (!dragging) return false;
  if (dragging.folder === null) return true;
  const parent = dragging.folder.split('/').slice(0, -1).join('/');
  return folder !== dragging.folder && !(folder + '/').startsWith(dragging.folder + '/') && folder !== parent;
}

noteListEl.addEventListener('dragover', (e) => {
  if (!dragging) return;
  const folder = folderUnder(e);
  clearDropTargets();
  if (!canDropOn(folder)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (folder) noteListEl.querySelector('details[data-folder="' + CSS.escape(folder) + '"]').classList.add('drop-target');
  else noteListEl.classList.add('drop-root');
});

noteListEl.addEventListener('dragleave', (e) => {
  if (!noteListEl.contains(e.relatedTarget)) clearDropTargets();
});

noteListEl.addEventListener('dragend', () => {
  dragging = null;
  clearDropTargets();
});

noteListEl.addEventListener('drop', async (e) => {
  const drag = dragging;
  const folder = folderUnder(e);
  const allowed = canDropOn(folder);
  dragging = null;
  clearDropTargets();
  if (!drag || !allowed) return;
  e.preventDefault();

  if (drag.folder !== null) {
    const name = drag.folder.split('/').pop();
    await renameFolder(drag.folder, folder ? folder + '/' + name : name);
  } else {
    // notes already in that folder are left out
    const paths = drag.paths.filter((p) => p.split('/').slice(0, -1).join('/') !== folder);
    if (paths.length) {
      try { await moveItems(paths, folder); } catch (err) { toast(err.message, true); }
    }
  }
});

// ================= Editor =================

const editor = new EasyMDE({
  element: document.getElementById('editor'),
  spellChecker: false,
  status: false,
  tabSize: 4,              // nested lists are indented with 4 spaces
  indentWithTabs: false,
  autoDownloadFontAwesome: false, // icons are served locally from /vendor/font-awesome
  unorderedListStyle: '-',       // the Bullet list button writes "- ", like the rest of the notes
  sideBySideFullscreen: false,   // side by side stays inside the page; it never takes over the screen
  // Ctrl+L belongs to the sidebar now. F11 would put the editor in fullscreen, which we do not want.
  shortcuts: { toggleUnorderedList: 'Shift-Cmd-8', toggleOrderedList: 'Shift-Cmd-7', toggleFullScreen: null },
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

// Is this line inside a ``` block? (counts the fences above it)
function inCodeFence(cm, lineNo) {
  let fences = 0;
  cm.eachLine(0, lineNo, (handle) => { if (/^\s*(```|~~~)/.test(handle.text)) fences++; });
  return fences % 2 === 1;
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

    const line = cm.getLine(cursor.line);

    // An empty bullet or task item: out one level, or at the top level the marker goes
    // and an empty line is left.
    if (/^\s*[-*+] (\[[ xX]\] )?\s*$/.test(line) && cursor.ch >= line.length - 1) {
      const outdented = /^\s/.test(line) ? line.replace(/^( {1,4}|\t)/, '') : '';
      cm.replaceRange(outdented, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
      cm.setCursor({ line: cursor.line, ch: outdented.length });
      return;
    }

    // An indented line that is not a list item: the new line starts at the left edge
    // (inside a code block the indent is kept, because code needs it)
    if (/^\s+\S/.test(line) && !/^\s*([-*+]|\d+[.)]) /.test(line) && !inCodeFence(cm, cursor.line)) {
      cm.replaceSelection('\n', 'end');
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
  if (!currentPath) return;
  dirty = true;
  updateTabDots();
  writeDraft(currentPath, editor.value());   // every change is kept locally right away
  scheduleSave();
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

// ---------- Live preview ----------
// Away from the cursor, the marks of bold, italic, strikethrough, `code`, headings (#) and quotes (>)
// are hidden, and the text keeps its look. The line with the cursor shows everything again.
// Only the lines that changed, and the lines the cursor left or entered, are touched.

const LIVE_PATTERNS = [
  { re: /\*\*(?=\S)(.+?)(?<=\S)\*\*/gu, n: 2 },                                                        // **bold**
  { re: /(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, n: 2 },                      // __bold__
  { re: /~~(?=\S)(.+?)(?<=\S)~~/gu, n: 2 },                                                           // ~~strikethrough~~
  { re: /(?<![*\w])\*(?![*\s])(.+?)(?<![*\s])\*(?!\*)/gu, n: 1 },                                    // *italic*
  { re: /(?<![\p{L}\p{N}_])_(?![_\s])(.+?)(?<![_\s])_(?![\p{L}\p{N}_])/gu, n: 1 },                  // _italic_
];

// The [from, to] ranges of one line that can be hidden
function liveRanges(text) {
  if (!/[*_~`#>]/.test(text)) return [];     // most lines: nothing to do
  const out = [];
  const taken = [];                           // hidden ranges must never overlap
  const free = (from, to) => !taken.some((r) => from < r[1] && to > r[0]);
  const hide = (from, to) => { if (free(from, to)) { out.push([from, to]); taken.push([from, to]); return true; } return false; };

  let m = text.match(/^#{1,6} /);
  if (m) hide(0, m[0].length);
  m = text.match(/^\s*(?:> ?)+/);
  if (m) hide(m[0].indexOf('>'), m[0].length);

  // `code`: the backticks go, and nothing inside is touched
  const code = [];
  for (const c of text.matchAll(/(`+)(.+?)\1/g)) {
    const from = c.index;
    const to = from + c[0].length;
    code.push([from, to]);
    hide(from, from + c[1].length);
    hide(to - c[1].length, to);
  }
  const inCode = (from, to) => code.some((r) => from < r[1] && to > r[0]);

  for (const { re, n } of LIVE_PATTERNS) {
    for (const c of text.matchAll(re)) {
      const from = c.index;
      const to = from + c[0].length;
      if (inCode(from, from + n) || inCode(to - n, to)) continue;
      if (free(from, from + n) && free(to - n, to)) { hide(from, from + n); hide(to - n, to); }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const liveMarks = new Map();    // line -> its marks
let liveBusy = [];              // lines that had the cursor last time
let liveFence = new Set();      // line numbers inside a ``` block (nothing is hidden there)

function liveFenceLines(cm) {
  const lines = new Set();
  let inside = false;
  let n = 0;
  cm.eachLine((handle) => {
    if (/^\s*(```|~~~)/.test(handle.text)) { inside = !inside; lines.add(n); }
    else if (inside) lines.add(n);
    n++;
  });
  return lines;
}

function liveBusyLines(cm) {
  const busy = new Set();
  for (const sel of cm.listSelections()) {
    for (let i = sel.from().line; i <= sel.to().line; i++) busy.add(i);
  }
  return busy;
}

function liveLine(cm, n, busy) {
  const handle = cm.getLineHandle(n);
  if (!handle) return;
  const old = liveMarks.get(handle);
  if (old) { old.forEach((mark) => mark.clear()); liveMarks.delete(handle); }
  if (!settings.livePreview || busy.has(n) || liveFence.has(n)) return;
  const marks = liveRanges(handle.text).map((r) => cm.markText({ line: n, ch: r[0] }, { line: n, ch: r[1] }, { collapsed: true }));
  if (marks.length) liveMarks.set(handle, marks);
}

function liveAll(cm) {
  cm.operation(() => {
    liveMarks.forEach((marks) => marks.forEach((mark) => mark.clear()));
    liveMarks.clear();
    liveFence = liveFenceLines(cm);
    const busy = liveBusyLines(cm);
    if (settings.livePreview) for (let n = 0; n < cm.lineCount(); n++) liveLine(cm, n, busy);
    liveBusy = Array.from(busy).map((n) => cm.getLineHandle(n));
  });
}

function updateLivePreview() { liveAll(editor.codemirror); }

editor.codemirror.on('changes', (cm, changes) => {
  if (!settings.livePreview) return;
  const isFence = (text) => /^\s*(```|~~~)/.test(text);
  let all = changes.length > 1;
  for (const c of changes) {
    if (c.text.length > 50 || c.removed.length > 50) all = true;             // a note was loaded or pasted
    if (c.removed.some(isFence)) all = true;
    for (let i = 0; i < c.text.length && !all; i++) if (isFence(cm.getLine(c.from.line + i) || '')) all = true;
  }
  if (all) { liveAll(cm); return; }

  cm.operation(() => {
    liveFence = liveFenceLines(cm);
    const busy = liveBusyLines(cm);
    const c = changes[0];
    for (let n = c.from.line; n < c.from.line + c.text.length; n++) liveLine(cm, n, busy);
    liveBusy = Array.from(busy).map((n) => cm.getLineHandle(n));
  });
});

editor.codemirror.on('cursorActivity', (cm) => {
  if (!settings.livePreview) return;
  const busy = liveBusyLines(cm);
  const handles = Array.from(busy).map((n) => cm.getLineHandle(n));
  const same = handles.length === liveBusy.length && handles.every((h, i) => h === liveBusy[i]);
  if (same) return;
  cm.operation(() => {
    for (const handle of liveBusy) {               // lines the cursor left
      const n = cm.getLineNumber(handle);
      if (n !== null) liveLine(cm, n, busy);
    }
    for (const n of busy) liveLine(cm, n, busy);    // lines it entered
    liveBusy = handles;
  });
});

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

// ================= Saving =================
// 1. Every change is written to a draft in localStorage at once.
// 2. The server gets the note 2.5 s after typing stops, and at least every 15 s while typing goes on.
// 3. It is also saved on switching tab or view, on leaving the window, and when the page closes.
// 4. If the server cannot be reached, the draft stays and saving is tried again (waiting longer each time).
//    A saved note clears its draft. A draft that is newer than the saved note is offered on opening it.

const SAVE_QUIET_MS = 2500;
const SAVE_MAX_MS = 15000;
let maxTimer = null;
const retries = {};      // path -> { timer, delay }

function draftKey(path) { return 'draft:' + path; }

function writeDraft(path, content) {
  try { localStorage.setItem(draftKey(path), JSON.stringify({ content: content, time: Date.now() })); } catch (err) { /* full or private mode */ }
}

function readDraft(path) {
  try { return JSON.parse(localStorage.getItem(draftKey(path))); } catch (err) { return null; }
}

function clearDraft(path) {
  try { localStorage.removeItem(draftKey(path)); } catch (err) { /* ignore */ }
}

// Only a problem is shown: "Offline, saved locally". Everything else is quiet.
function setSaveState(text) {
  const el = document.getElementById('save-state');
  el.textContent = text;
  el.dataset.state = text ? 'offline' : '';
  updateTabDots();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, SAVE_QUIET_MS);
  if (!maxTimer) maxTimer = setTimeout(saveNote, SAVE_MAX_MS);
}

function stopSaveTimers() {
  clearTimeout(saveTimer);
  clearTimeout(maxTimer);
  maxTimer = null;
}

// Sends one note to the server. Returns true when it is saved there.
async function sendNote(path, content) {
  try {
    await api('/api/note?path=' + encodeURIComponent(path), { method: 'PUT', body: { content: content } });
    const draft = readDraft(path);
    if (draft && draft.content === content) clearDraft(path);
    if (retries[path]) { clearTimeout(retries[path].timer); delete retries[path]; }
    return true;
  } catch (err) {
    retrySoon(path);
    return false;
  }
}

// Try again later (2 s, 4 s, 8 s ... at most a minute), with the newest draft
function retrySoon(path) {
  const retry = retries[path] || (retries[path] = { delay: 2000, timer: null });
  clearTimeout(retry.timer);
  retry.timer = setTimeout(async () => {
    const draft = readDraft(path);
    if (!draft) { delete retries[path]; return; }
    retry.delay = Math.min(retry.delay * 2, 60000);
    if (await sendNote(path, draft.content) && path === currentPath && editor.value() === draft.content) {
      dirty = false;
      setSaveState('');
    }
  }, retry.delay);
  if (path === currentPath) setSaveState('Offline, saved locally');
}

async function saveNote() {
  if (!currentPath || !dirty) return;
  stopSaveTimers();
  const path = currentPath;
  const content = editor.value();
  writeDraft(path, content);
  if (!(await sendNote(path, content))) return;
  if (path !== currentPath) return;
  if (editor.value() === content) {
    dirty = false;
    setSaveState('');
  } else {
    scheduleSave();       // typing went on while saving
  }
}

// For the moment the page is hidden or closed: a normal request may be cut off, "keepalive" is not.
// (It cannot be longer than 64 KB; a bigger note stays in the local draft and is offered next time.)
function saveBeforeLeaving() {
  if (!currentPath || !dirty) return;
  const content = editor.value();
  writeDraft(currentPath, content);
  fetch('/api/note?path=' + encodeURIComponent(currentPath), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content }),
    keepalive: true,
  }).catch(() => { /* the draft is still there */ });
}

window.addEventListener('blur', () => saveNote());
window.addEventListener('online', () => Object.keys(retries).forEach(retrySoon));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveBeforeLeaving(); });
window.addEventListener('beforeunload', saveBeforeLeaving);

// A draft newer than the note on the server: ask what to do
const draftBar = document.getElementById('draft-bar');
let draftPath = null;

function hideDraftBar() {
  draftBar.hidden = true;
  draftPath = null;
}

// Called after a note is loaded. server = { content, modified }
function checkDraft(path, server) {
  hideDraftBar();
  const draft = readDraft(path);
  if (!draft) return;
  if (draft.content === server.content || draft.time <= server.modified) {
    clearDraft(path);                 // nothing to restore: the server has the same or a newer text
    return;
  }
  const when = new Date(draft.time);
  const today = new Date().toDateString() === when.toDateString();
  document.getElementById('draft-text').textContent = 'Unsaved changes from '
    + (today ? '' : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ')
    + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' were found.';
  draftPath = path;
  draftBar.hidden = false;
}

document.getElementById('draft-restore').addEventListener('click', () => {
  const draft = draftPath && readDraft(draftPath);
  if (draft && draftPath === currentPath) {
    editor.value(draft.content);
    dirty = true;
    updateTabDots();
    scheduleSave();
  }
  hideDraftBar();
});

document.getElementById('draft-discard').addEventListener('click', () => {
  if (draftPath) clearDraft(draftPath);
  hideDraftBar();
});

// ================= Tabs =================
// Every open note is a tab. There is still only one editor: switching tabs saves the note,
// loads the other one and puts the cursor and scroll position back where they were.

let tabs = [];   // [{ path, cursor, scroll, file }] in the order shown. file: true = not a note (shown in the viewer)
let currentFile = null;   // path of the file open in the viewer (then currentPath is null)

const activePath = () => currentPath || currentFile;
const openTab = (tab) => (tab.file ? openFile(tab.path) : openNote(tab.path));

function tabFor(path) {
  return tabs.find((t) => t.path === path);
}

// Where I am in each note: cursor and selection, scroll position of the editor and of the preview panes.
// It is tracked all the time (not only when switching), because an editor that is hidden cannot
// tell its scroll position. It is saved with the open tabs, so a reload keeps it too.
let restoring = false;          // true while a tab is being put back, so half-finished positions are not stored
let tabStateTimer = null;

function trackTab() {
  if (restoring || !currentPath) return;
  const tab = tabFor(currentPath);
  const cm = editor.codemirror;
  if (!tab || cm.getWrapperElement().offsetParent === null) return;    // the editor is not on screen
  const sel = cm.listSelections()[0];
  const info = cm.getScrollInfo();
  tab.sel = { anchor: sel.anchor, head: sel.head };
  tab.scroll = { left: info.left, top: info.top };
  tab.preview = editor.isPreviewActive();
  const full = document.querySelector('.editor-preview');
  const side = document.querySelector('.editor-preview-side');
  if (full && full.offsetParent !== null) tab.previewTop = full.scrollTop;
  if (side && side.offsetParent !== null) tab.sideTop = side.scrollTop;
  clearTimeout(tabStateTimer);
  tabStateTimer = setTimeout(saveTabs, 400);
}

const rememberTab = trackTab;
editor.codemirror.on('cursorActivity', trackTab);
document.querySelector('.editor-wrap').addEventListener('scroll', trackTab, true);       // editor and both previews
document.querySelector('.editor-wrap').addEventListener('click', () => setTimeout(trackTab, 0), true);   // preview buttons

// Puts the position of a tab back. Done after the note is in the editor, the editor is on screen and
// CodeMirror has measured it, and once more a moment later (fonts, images and diagrams change heights).
function restoreTab(tab) {
  const cm = editor.codemirror;
  restoring = true;
  const apply = () => {
    cm.refresh();
    if (tab.sel) cm.setSelection(tab.sel.anchor, tab.sel.head, { scroll: false });
    if (tab.scroll) cm.scrollTo(tab.scroll.left, tab.scroll.top);
    const full = document.querySelector('.editor-preview');
    const side = document.querySelector('.editor-preview-side');
    if (full && tab.previewTop) full.scrollTop = tab.previewTop;
    if (side && tab.sideTop) side.scrollTop = tab.sideTop;
  };
  apply();
  requestAnimationFrame(apply);
  setTimeout(() => { apply(); restoring = false; }, 120);
}

function saveTabs() {
  try {
    localStorage.setItem('tabs', JSON.stringify(tabs.map((t) => t.path)));
    const state = {};
    for (const t of tabs) {
      if (t.sel || t.scroll) state[t.path] = { sel: t.sel, scroll: t.scroll, preview: t.preview, previewTop: t.previewTop, sideTop: t.sideTop };
    }
    localStorage.setItem('tabState', JSON.stringify(state));
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
  const unsaved = dirty;
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
    el.className = 'tab' + (tab.path === activePath() ? ' active' : '');
    el.dataset.path = tab.path;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', tab.path === activePath() ? 'true' : 'false');
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
      if (tab.path !== activePath()) openTab(tab);
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
        e.preventDefault();
        if (tab.path !== activePath()) openTab(tab);
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

  if (path !== activePath()) {
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
    await openTab(next);
  } else {
    showNothingOpen();
  }
}

// No tab left: back to the empty state
function showNothingOpen() {
  currentPath = null;
  currentFile = null;
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
  const wasOpen = activePath() && gone.has(activePath());
  const index = tabs.findIndex((t) => t.path === activePath());

  tabs = tabs.filter((t) => !gone.has(t.path));
  if (!wasOpen) {
    saveTabs();
    renderTabs();
    return;
  }
  dirty = false;
  clearTimeout(saveTimer);
  const next = tabs[Math.min(index, tabs.length - 1)];
  if (next) await openTab(next);
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
  if (currentFile && changes[currentFile]) {
    currentFile = changes[currentFile];
    showFileViewer(currentFile);
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
    currentFile = null;
    if (!tabFor(path)) tabs.push({ path: path });
    const tab = tabFor(path);

    restoring = true;              // while the note is swapped, positions are not stored
    if (editor.isPreviewActive()) editor.togglePreview(); // the preview would still show the old note
    editor.value(data.content);
    dirty = false;
    setSaveState('');
    document.getElementById('note-title').value = path.replace(/\.md$/, '');
    showView('notes');
    showNoteEditor(true);

    // back where I was in this note (the editor is on screen now, so it can measure itself)
    const cm = editor.codemirror;
    if (tab.preview && !editor.isPreviewActive()) editor.togglePreview();
    restoreTab(tab);
    checkDraft(path, data);
    if (!quiet && desktop.matches) cm.focus();

    renderTabs();
    saveTabs();
    renderNoteList(visibleEntries());
    document.body.classList.remove('menu-open');
  } catch (err) {
    restoring = false;
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
  document.getElementById('file-viewer').hidden = true;
  document.querySelector('#view-notes .view-head').hidden = !show;
  document.querySelector('.editor-wrap').hidden = !show;
  document.getElementById('empty-notes').hidden = show;
  if (show) editor.codemirror.refresh();
}

// ---------- Files that are not notes: opened in a tab with a small viewer ----------

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;
const TEXT_FILE = /\.(txt|log|json|csv|tsv|js|mjs|ts|py|css|html?|xml|ya?ml|toml|ini|conf|cfg|sh|sql|java|c|h|cpp|go|rs|rb|php|diff|patch)$/i;
let fileToken = 0;   // so a slow file does not show up after you moved to another tab

async function openFile(path) {
  await saveNote();
  rememberTab();
  currentPath = null;
  currentFile = path;
  dirty = false;
  clearTimeout(saveTimer);
  setSaveState('');
  if (!tabFor(path)) tabs.push({ path: path, file: true });
  showView('notes');
  showFileViewer(path);
  renderTabs();
  saveTabs();
  renderNoteList(visibleEntries());
  document.body.classList.remove('menu-open');
}

// A simple CSV reader: quotes may hold the separator and line breaks
function parseCsv(text, separator) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function showFileViewer(path) {
  document.querySelector('#view-notes .view-head').hidden = true;
  document.querySelector('.editor-wrap').hidden = true;
  document.getElementById('empty-notes').hidden = true;
  document.getElementById('file-viewer').hidden = false;

  const entry = entries.find((e) => e.path === path);
  const size = entry ? entry.size : 0;
  const name = path.split('/').pop();
  const url = '/files/' + path.split('/').map(encodeURIComponent).join('/');
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  const token = ++fileToken;

  document.getElementById('file-name').textContent = name;
  document.getElementById('file-info').textContent = prettySize(size);
  const download = document.getElementById('file-download');
  download.href = url;
  download.setAttribute('download', name);

  const body = document.getElementById('file-body');
  body.innerHTML = '';
  body.scrollTop = 0;

  const tooBig = size > settings.maxFileMB * 1024 * 1024;
  const isPdf = /\.pdf$/i.test(name);
  const isImage = IMAGE_FILE.test(name);
  const isText = TEXT_FILE.test(name);

  if (tooBig || !(isPdf || isImage || isText)) {
    const card = document.createElement('div');
    card.className = 'file-card';
    const title = document.createElement('h2');
    title.textContent = name;
    const type = document.createElement('p');
    type.textContent = (ext ? ext + ' file' : 'File') + ', ' + prettySize(size);
    card.append(title, type);
    if (tooBig) {
      const why = document.createElement('p');
      why.textContent = 'Bigger than the ' + settings.maxFileMB + ' MB limit for viewing (see Settings).';
      card.appendChild(why);
    }
    const link = document.createElement('a');
    link.className = 'primary';
    link.href = url;
    link.setAttribute('download', name);
    link.textContent = 'Download';
    card.appendChild(link);
    body.appendChild(card);
  } else if (isImage) {
    const box = document.createElement('div');
    box.className = 'image-box';
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.title = 'Click to zoom';
    img.addEventListener('click', () => img.classList.toggle('zoomed'));
    box.appendChild(img);
    body.appendChild(box);
  } else if (isPdf) {
    // The browser's own PDF viewer. /files does not send the sandbox header for PDFs, so this works.
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = name;
    body.appendChild(frame);
  } else {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not read the file');
      let text = await res.text();
      if (token !== fileToken) return;
      const cut = text.length > 1000000;
      if (cut) text = text.slice(0, 1000000);

      if (/\.(csv|tsv)$/i.test(name)) {
        const rows = parseCsv(text, /\.tsv$/i.test(name) ? '\t' : ',');
        const table = document.createElement('table');
        for (const row of rows.slice(0, 2000)) {
          const tr = table.insertRow();
          for (const value of row) tr.insertCell().textContent = value;
        }
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        wrap.appendChild(table);
        body.appendChild(wrap);
        if (rows.length > 2000) addFileNote(body, 'Showing the first 2000 rows.');
      } else {
        const pre = document.createElement('pre');
        pre.textContent = text;
        body.appendChild(pre);
      }
      if (cut) addFileNote(body, 'Showing the first 1 MB. Download the file to see all of it.');
    } catch (err) {
      body.textContent = err.message;
    }
  }
}

function addFileNote(body, text) {
  const p = document.createElement('div');
  p.className = 'file-note';
  p.textContent = text;
  body.appendChild(p);
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
  await reloadSettings();     // hidden items and folder colours move along with their notes
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
    const parts = (note.kind === 'folder' ? note.path : noteFolder(note.path)).split('/').filter(Boolean);
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

  try {
    moveDialog.close();
    await moveItems(Array.from(selected), folder);
  } catch (err) {
    toast(err.message, true);
  }
});

// Moves notes and files into a folder ('' = top level). Used by the Move dialog and by drag and drop.
async function moveItems(paths, folder) {
  await saveNote();
  const result = await api('/api/notes/move', { method: 'POST', body: { paths: paths, folder: folder } });

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
}

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

// ================= Keyboard shortcuts =================

const isMac = /Mac/.test(navigator.platform);

// The list in Settings. "Mod" is Ctrl (Cmd on a Mac).
const SHORTCUTS = [
  ['Show or hide the sidebar', 'Mod+L'],
  ['Go to Notes', 'Alt+Shift+N'],
  ['Go to Calendar', 'Alt+Shift+C'],
  ['Go to Tasks', 'Alt+Shift+K'],
  ['Full view (writing mode)', 'Alt+Shift+F'],
  ['Save now', 'Mod+S'],
  ['Previous or next tab', 'Alt+PageUp, Alt+PageDown'],
  ['Close tab', 'Alt+W'],
  ['Bold, italic, link', 'Mod+B, Mod+I, Mod+K'],
  ['Bullet list', 'Mod+Shift+8'],
  ['Numbered list', 'Mod+Shift+7'],
  ['Task list', 'Mod+Shift+L'],
  ['Preview, side by side', 'Mod+P, F9'],
  ['Indent or outdent a list item', 'Tab, Shift+Tab'],
  ['Close a menu, leave full view', 'Esc'],
];

function renderShortcutList() {
  const list = document.getElementById('shortcut-list');
  list.innerHTML = '';
  for (const [what, keys] of SHORTCUTS) {
    const dt = document.createElement('dt');
    dt.textContent = what;
    const dd = document.createElement('dd');
    keys.split(', ').forEach((combo, i) => {
      if (i) dd.append(' ');
      const kbd = document.createElement('kbd');
      kbd.textContent = combo.replace('Mod', isMac ? 'Cmd' : 'Ctrl').replace('Alt', isMac ? 'Option' : 'Alt');
      dd.appendChild(kbd);
    });
    list.append(dt, dd);
  }
}

// Alt+Shift+letter is used for the views. (Alt+Shift+T would clash with "focus the toolbar" in Chrome,
// so Tasks is K.) Letters are read from the key, with the physical key as a fallback for a Mac.
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const letter = (e.key || '').length === 1 ? e.key.toLowerCase() : '';
  const is = (l, code) => letter === l || e.code === code;

  // Ctrl+L: sidebar. preventDefault also stops the browser from jumping to the address bar.
  if (mod && !e.altKey && !e.shiftKey && is('l', 'KeyL')) {
    e.preventDefault();
    if (desktop.matches) setSidebarCollapsed(!isCollapsed());
    else document.body.classList.toggle('menu-open');
    return;
  }

  if (e.altKey && e.shiftKey && !mod && !document.querySelector('dialog[open]')) {
    const views = [['n', 'KeyN', 'notes'], ['c', 'KeyC', 'calendar'], ['k', 'KeyK', 'tasks']];
    const hit = views.find(([l, code]) => is(l, code));
    if (hit) {
      e.preventDefault();
      document.querySelector('#sidebar button[data-view="' + hit[2] + '"]').click();
    } else if (is('f', 'KeyF')) {
      e.preventDefault();
      setFullView(!document.body.classList.contains('full-view'));
    }
  }
}, true);

// ================= Full view (writing mode) =================
// Only the editor is left, in the middle. The toolbar shows when the mouse is at the top or has focus.

function setFullView(on) {
  if (on && (currentView !== 'notes' || !currentPath)) return;
  document.body.classList.toggle('full-view', on);
  editor.codemirror.refresh();
  if (calendar) calendar.updateSize();
  if (on) {
    toast('Full view. Press Esc to leave it.');
    editor.codemirror.focus();
  }
}

document.getElementById('full-view').addEventListener('click', () => setFullView(true));

// ================= Wide editor, and the line between the editor and the preview =================

function applyLookSettings() {
  document.body.classList.toggle('wide-editor', settings.wideEditor);
}

// Side by side: drag the line to change the width of the two parts. The place is remembered.
const editorBox = document.querySelector('.EasyMDEContainer');
const splitHandle = document.createElement('div');
splitHandle.id = 'split-handle';
splitHandle.setAttribute('role', 'separator');
splitHandle.setAttribute('aria-orientation', 'vertical');
splitHandle.setAttribute('aria-label', 'Resize the editor and the preview');
splitHandle.tabIndex = 0;
editorBox.appendChild(splitHandle);

function setSplit(fraction, save = true) {
  fraction = Math.max(0.2, Math.min(0.8, fraction));
  editorBox.style.setProperty('--split', fraction);
  if (save) remember('splitPosition', fraction);
  editor.codemirror.refresh();
}

setSplit(parseFloat(localStorage.getItem('splitPosition')) || 0.5, false);

splitHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitHandle.setPointerCapture(e.pointerId);
  document.body.classList.add('splitting');
});
splitHandle.addEventListener('pointermove', (e) => {
  if (!splitHandle.hasPointerCapture(e.pointerId)) return;
  const box = editorBox.getBoundingClientRect();
  setSplit((e.clientX - box.left) / box.width, false);
});
splitHandle.addEventListener('pointerup', (e) => {
  splitHandle.releasePointerCapture(e.pointerId);
  document.body.classList.remove('splitting');
  remember('splitPosition', editorBox.style.getPropertyValue('--split'));
});
splitHandle.addEventListener('dblclick', () => setSplit(0.5));
splitHandle.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setSplit((parseFloat(editorBox.style.getPropertyValue('--split')) || 0.5) + (e.key === 'ArrowRight' ? 0.02 : -0.02));
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

// ---------- Categories (a #tag on the line, colours from Settings) ----------

function categoryOf(name) {
  if (!name) return null;
  return settings.categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}

// "cat-lake" for a task in the "kolokvij" category, or '' (no category, or one that is not in Settings)
function categoryClass(name) {
  const category = categoryOf(name);
  return category ? 'cat-' + category.color : '';
}

// Fills a <select> with "No category" and the categories of Settings (plus the item's own, if it is not listed)
function fillCategorySelect(select, current) {
  select.innerHTML = '';
  select.add(new Option('No category', ''));
  for (const c of settings.categories) select.add(new Option(c.name, c.name));
  if (current && !categoryOf(current)) select.add(new Option(current, current));
  select.value = current ? (categoryOf(current) ? categoryOf(current).name : current) : '';
}

// The calendar can hide categories. The choice is remembered ('' stands for "no category").
function hiddenCategories() {
  try { return new Set(JSON.parse(localStorage.getItem('hiddenCategories') || '[]')); } catch (err) { return new Set(); }
}

function renderCategoryFilter() {
  const box = document.getElementById('cat-filter');
  box.innerHTML = '';
  box.hidden = settings.categories.length === 0;
  const hidden = hiddenCategories();

  const entries = settings.categories.map((c) => ({ key: c.name.toLowerCase(), label: c.name, cls: 'cat-' + c.color }))
    .concat([{ key: '', label: 'No category', cls: '' }]);
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cat-toggle ' + entry.cls + (hidden.has(entry.key) ? ' off' : '');
    button.setAttribute('aria-pressed', hidden.has(entry.key) ? 'false' : 'true');
    button.innerHTML = '<span class="cat-dot"></span>';
    button.append(entry.label);
    button.addEventListener('click', () => {
      const now = hiddenCategories();
      if (now.has(entry.key)) now.delete(entry.key); else now.add(entry.key);
      try { localStorage.setItem('hiddenCategories', JSON.stringify(Array.from(now))); } catch (err) { /* not remembered */ }
      renderCategoryFilter();
      if (calendar) calendar.refetchEvents();
    });
    box.appendChild(button);
  }
}

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
  const r = item.repeat;
  return r.text + (r.until ? ' until ' + prettyDate(r.until) : '') + (r.count ? ', ' + r.count + (r.count === 1 ? ' time' : ' times') : '');
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
  const hidden = hiddenCategories();
  items.forEach((item, index) => {
    if (!item.date) return;
    if (settings.categories.length && hidden.has((item.category || '').toLowerCase())) return;
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
      const cls = categoryClass(item.category);
      if (cls) wrap.classList.add('cat', cls);
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
        openPopover(item, info.el);
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
  const mode = localStorage.getItem('taskGroup') === 'category' ? 'category' : 'date';
  document.querySelectorAll('#task-group-switch button').forEach((b) => b.classList.toggle('active', b.dataset.group === mode));

  const done = { name: 'Done', className: 'done-group', list: [] };
  let groups;

  if (mode === 'date') {
    groups = [
      { name: 'Overdue', className: 'overdue', list: [] },
      { name: 'Today', className: 'today', list: [] },
      { name: 'Next 7 days', className: '', list: [] },
      { name: 'Later', className: '', list: [] },
      { name: 'No date', className: '', list: [] },
    ];
    for (const item of items) {
      if (item.type !== 'task') continue;
      if (item.done) done.list.push(item);
      else if (!item.date) groups[4].list.push(item);
      else if (item.date < today) groups[0].list.push(item);
      else if (item.date === today) groups[1].list.push(item);
      else if (item.date <= inAWeek) groups[2].list.push(item);
      else groups[3].list.push(item);
    }
  } else {
    // One group per category, in the order of Settings. Tags that are not in Settings come after them.
    groups = settings.categories.map((c) => ({ name: c.name, className: '', cat: 'cat-' + c.color, key: c.name.toLowerCase(), list: [] }));
    const none = { name: 'No category', className: '', key: '', list: [] };
    for (const item of items) {
      if (item.type !== 'task') continue;
      if (item.done) { done.list.push(item); continue; }
      const key = (item.category || '').toLowerCase();
      let group = groups.find((g) => g.key === key);
      if (!group && key) {
        group = { name: item.category, className: '', key: key, list: [] };
        groups.push(group);
      }
      (group || none).list.push(item);
    }
    groups.push(none);
  }
  groups.push(done);

  const container = document.getElementById('task-groups');
  container.innerHTML = '';
  let total = 0;

  for (const group of groups) {
    if (group.list.length === 0) continue;
    total += group.list.length;
    group.list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

    const section = document.createElement(group.name === 'Done' ? 'details' : 'section');
    section.className = 'task-group ' + group.className;

    const heading = document.createElement(group.name === 'Done' ? 'summary' : 'h2');
    if (group.cat) {
      heading.classList.add(group.cat);
      heading.innerHTML = '<span class="cat-dot"></span>';
    }
    heading.append(group.name + ' ');
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = group.list.length;
    heading.appendChild(count);
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

document.querySelectorAll('#task-group-switch button').forEach((button) => {
  button.addEventListener('click', () => {
    try { localStorage.setItem('taskGroup', button.dataset.group); } catch (err) { /* not remembered */ }
    renderTasks();
  });
});

function taskRow(item) {
  const li = document.createElement('li');
  const catClass = categoryClass(item.category);
  li.className = 'task-row' + (item.done ? ' done' : '') + (catClass ? ' cat ' + catClass : '');

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
  title.tabIndex = 0;
  title.setAttribute('role', 'button');
  title.title = 'Edit';
  title.addEventListener('click', () => openPopover(item, title));
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') openPopover(item, title); });

  const meta = document.createElement('span');
  meta.className = 'task-meta';
  if (item.category) {
    const label = document.createElement('span');
    label.className = 'cat-label ' + catClass;
    label.innerHTML = '<span class="cat-dot"></span>';
    label.append(item.category);
    meta.appendChild(label);
  }
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

// "Ends" (Never / On date / After N times) is only there when the item repeats
function syncEnds(form) {
  const row = form.querySelector('.ends-row');
  row.hidden = !form.repeat.value || form.repeat.value === 'none';
  row.querySelector('.ends-date').hidden = form.ends.value !== 'date';
  row.querySelector('.ends-count').hidden = form.ends.value !== 'count';
}
addForm.repeat.addEventListener('change', () => syncEnds(addForm));
addForm.ends.addEventListener('change', () => syncEnds(addForm));

function openAddDialog(date = '', time = '') {
  addForm.reset();
  addForm.date.value = date;
  addForm.time.value = time;
  fillCategorySelect(addForm.category, '');
  syncEnds(addForm);
  addForm.more.checked = localStorage.getItem('createMore') === '1';
  dialog.showModal();
  addForm.text.focus();
}

document.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => openAddDialog(isoDate(new Date())));
});
document.getElementById('add-cancel').addEventListener('click', () => dialog.close());
addForm.more.addEventListener('change', () => {
  try { localStorage.setItem('createMore', addForm.more.checked ? '1' : '0'); } catch (err) { /* not remembered */ }
});

// ---------- Edit popover (calendar and Tasks view) ----------

const popover = document.getElementById('item-popover');
const popForm = document.getElementById('popover-form');
let popItem = null;

const REPEAT_RULES = [['', 'Does not repeat'], ['every day', 'Every day'], ['every weekday', 'Every weekday'],
  ['every week', 'Every week'], ['every month', 'Every month'], ['every year', 'Every year']];

function syncPopoverEnds() {
  syncEnds(popForm);
}
popForm.repeat.addEventListener('change', syncPopoverEnds);
popForm.ends.addEventListener('change', syncPopoverEnds);

function openPopover(item, anchor) {
  popItem = item;
  popover.dataset.type = item.type;
  popForm.title.value = item.title;
  popForm.date.value = item.date || '';
  popForm.time.value = item.time ? item.time.padStart(5, '0') : '';
  fillCategorySelect(popForm.category, item.category || '');
  popForm.done.checked = item.done;

  popForm.repeat.innerHTML = '';
  const current = item.repeat ? item.repeat.text : '';
  for (const [value, label] of REPEAT_RULES) popForm.repeat.add(new Option(label, value));
  if (current && !REPEAT_RULES.some((r) => r[0] === current)) popForm.repeat.add(new Option(current, current));
  popForm.repeat.value = current;
  const repeat = item.repeat || {};
  popForm.ends.value = repeat.until ? 'date' : repeat.count ? 'count' : 'never';
  popForm.until.value = repeat.until || '';
  popForm.count.value = repeat.count || 10;
  syncPopoverEnds();

  popover.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popForm.title.focus();
}

function closePopover() {
  popover.hidden = true;
  popItem = null;
}

document.addEventListener('mousedown', (e) => {
  if (!popover.hidden && !popover.contains(e.target)) closePopover();
});

popForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = popItem;
  if (!item) return;
  if (popForm.repeat.value && !popForm.date.value) {
    toast('Pick a date for a repeating item', true);
    popForm.date.focus();
    return;
  }
  // the rule and how it ends are written together: "every week until 2026-12-20" or "every week count 10"
  let repeat = popForm.repeat.value;
  if (repeat && popForm.ends.value === 'date') {
    if (!popForm.until.value || popForm.until.value < popForm.date.value) {
      toast('Pick the last date, on or after the first one', true);
      popForm.until.focus();
      return;
    }
    repeat += ' until ' + popForm.until.value;
  } else if (repeat && popForm.ends.value === 'count') {
    repeat += ' count ' + Math.max(1, parseInt(popForm.count.value, 10) || 1);
  }
  const changes = {
    edit: {
      title: popForm.title.value,
      category: popForm.category.value,
      date: popForm.date.value,
      time: popForm.time.value,
      repeat: repeat,
    },
  };
  if (item.type === 'task' && popForm.done.checked !== item.done) changes.done = popForm.done.checked;
  if (await updateItem(item, changes)) {
    closePopover();
    toast('Saved');
    await refreshItems();
  }
});

document.getElementById('popover-open').addEventListener('click', () => {
  const path = popItem.path;
  closePopover();
  openNote(path);
});

document.getElementById('popover-delete').addEventListener('click', async () => {
  const item = popItem;
  if (!confirm('Delete this ' + item.type + '?\n\n' + item.title)) return;
  try {
    await api('/api/items', { method: 'DELETE', body: { path: item.path, line: item.line, raw: item.raw } });
    closePopover();
    toast('Deleted');
    await refreshItems();
  } catch (err) {
    toast(err.message, true);
  }
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (addForm.repeat.value !== 'none' && !addForm.date.value) {
    toast('Pick a date for a repeating item', true);
    addForm.date.focus();
    return;
  }
  if (addForm.repeat.value !== 'none' && addForm.ends.value === 'date' && (!addForm.until.value || addForm.until.value < addForm.date.value)) {
    toast('Pick the last date, on or after the first one', true);
    addForm.until.focus();
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
        category: addForm.category.value,
        ends: addForm.ends.value,
        until: addForm.until.value,
        count: addForm.count.value,
      },
    });
    toast('Added "' + addForm.text.value.trim() + '" to Inbox');
    if (addForm.more.checked) {
      // Stay open for the next one: only the text is cleared
      addForm.text.value = '';
      addForm.text.focus();
      loadNotes().then(refreshItems);        // in the background
    } else {
      dialog.close();
      await loadNotes();
      await refreshItems();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

// ================= Switching views =================

async function showView(name) {
  if (name === currentView && name !== 'notes') return;
  const leavingNotes = currentView === 'notes' && name !== 'notes';
  currentView = name;
  closePopover();
  if (name !== 'notes') document.body.classList.remove('full-view');

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
    const index = tabs.findIndex((t) => t.path === activePath());
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next && next.path !== activePath()) openTab(next);
  } else if (e.code === 'KeyW' && activePath()) {
    e.preventDefault();
    closeTab(activePath());
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!popover.hidden) { closePopover(); return; }
  if (!menu.hidden) { closeMenu(); return; }
  if (document.body.classList.contains('full-view') && !document.querySelector('dialog[open]')) { setFullView(false); return; }
  document.body.classList.remove('menu-open');
  if (selected.size && !document.querySelector('dialog[open]')) clearSelection();
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
const TAG_NAME = /^\p{L}[\p{L}\p{N}_-]*$/u;

document.getElementById('open-settings').addEventListener('click', () => {
  settingsForm.showInbox.checked = settings.showInbox;
  settingsForm.livePreview.checked = settings.livePreview;
  settingsForm.maxFileMB.value = settings.maxFileMB;
  settingsForm.wideEditor.checked = settings.wideEditor;
  settingsForm.showHidden.checked = settings.showHidden;
  renderHiddenList();
  document.getElementById('inbox-hint').textContent = 'Quick add still writes to ' + settings.inbox
    + '. When it is hidden here, you can still find it with search.';
  renderCategoryRows();
  settingsDialog.showModal();
  document.body.classList.remove('menu-open');
});

// Sends changed settings to the server and redraws what depends on them
async function saveSettings(changes) {
  try {
    settings = await api('/api/settings', { method: 'PUT', body: changes });
  } catch (err) {
    toast(err.message, true);
    settings = await api('/api/settings').catch(() => settings);   // back to what the server has
  }
  renderNoteList(visibleEntries());
  renderCategoryFilter();
  updateLivePreview();
  applyLookSettings();
  renderCategoryRows();
  renderHiddenList();
  if (currentView === 'tasks') renderTasks();
  if (currentView === 'calendar' && calendar) calendar.refetchEvents();
}

settingsForm.showInbox.addEventListener('change', () => saveSettings({ showInbox: settingsForm.showInbox.checked }));
settingsForm.livePreview.addEventListener('change', () => saveSettings({ livePreview: settingsForm.livePreview.checked }));
settingsForm.wideEditor.addEventListener('change', () => saveSettings({ wideEditor: settingsForm.wideEditor.checked }));
settingsForm.showHidden.addEventListener('change', () => saveSettings({ showHidden: settingsForm.showHidden.checked }));
settingsForm.maxFileMB.addEventListener('change', () => saveSettings({ maxFileMB: parseInt(settingsForm.maxFileMB.value, 10) }));

// The hidden notes, files and folders, each with an Unhide button
function renderHiddenList() {
  const list = document.getElementById('hidden-list');
  list.innerHTML = '';
  for (const path of settings.hidden) {
    const row = document.createElement('div');
    row.className = 'hidden-row';
    const name = document.createElement('span');
    name.textContent = path.replace(/\.md$/, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = 'Unhide';
    button.setAttribute('aria-label', 'Unhide ' + path);
    button.addEventListener('click', () => unhideItems([path]));
    row.append(name, button);
    list.appendChild(row);
  }
}

// One row per category: name, colour, up, down, remove. Every change is saved at once.
function renderCategoryRows() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  const categories = settings.categories;

  categories.forEach((category, i) => {
    const row = document.createElement('div');
    row.className = 'cat-row';

    const name = document.createElement('input');
    name.value = category.name;
    name.maxLength = 30;
    name.setAttribute('aria-label', 'Category name');
    name.addEventListener('change', () => {
      const value = name.value.trim().replace(/^#/, '');
      const taken = categories.some((c, k) => k !== i && c.name.toLowerCase() === value.toLowerCase());
      if (!TAG_NAME.test(value) || taken) {
        toast(taken ? 'That category already exists' : 'Start with a letter; then letters, numbers, - and _', true);
        name.value = category.name;
        return;
      }
      saveSettings({ categories: categories.map((c, k) => (k === i ? { name: value, color: c.color } : c)) });
    });

    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const color of settings.palette) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch cat-' + color + (color === category.color ? ' on' : '');
      swatch.title = color;
      swatch.setAttribute('aria-label', 'Colour ' + color);
      swatch.addEventListener('click', () => saveSettings({ categories: categories.map((c, k) => (k === i ? { name: c.name, color: color } : c)) }));
      swatches.appendChild(swatch);
    }

    const mini = (text, label, disabled, action) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini';
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label + ' ' + category.name);
      b.disabled = disabled;
      b.addEventListener('click', action);
      return b;
    };
    const swap = (k) => { const copy = categories.slice(); [copy[i], copy[k]] = [copy[k], copy[i]]; saveSettings({ categories: copy }); };
    row.append(
      name, swatches,
      mini('\u2191', 'Move up', i === 0, () => swap(i - 1)),
      mini('\u2193', 'Move down', i === categories.length - 1, () => swap(i + 1)),
      mini('\u00d7', 'Remove', false, () => saveSettings({ categories: categories.filter((c, k) => k !== i) })));
    list.appendChild(row);
  });
}

// A new category gets a free name and the next colour
document.getElementById('category-add').addEventListener('click', async () => {
  const categories = settings.categories;
  let n = 1;
  while (categories.some((c) => c.name.toLowerCase() === 'category' + n)) n++;
  const color = settings.palette.find((p) => !categories.some((c) => c.color === p)) || settings.palette[0];
  await saveSettings({ categories: categories.concat([{ name: 'category' + n, color: color }]) });
  const inputs = document.querySelectorAll('#category-list .cat-row input');
  const last = inputs[inputs.length - 1];
  if (last) { last.focus(); last.select(); }
});

// ================= Start =================

async function start() {
  document.body.dataset.view = 'notes';
  settings = await api('/api/settings').catch(() => settings);
  applyLookSettings();
  renderShortcutList();
  renderCategoryFilter();
  loadItems().catch(() => {}); // only for the overdue badge
  await loadNotes();

  // Open tabs from last time (only notes that still exist)
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('tabs') || '[]'); } catch (err) { /* ignore */ }
  const last = localStorage.getItem('lastNote');
  if (!Array.isArray(saved) || saved.length === 0) saved = last ? [last] : [];
  tabs = saved.filter((p) => typeof p === 'string' && entries.some((n) => n.path === p))
    .map((p) => (p.endsWith('.md') ? { path: p } : { path: p, file: true }));
  try {
    const state = JSON.parse(localStorage.getItem('tabState') || '{}');
    for (const tab of tabs) Object.assign(tab, state[tab.path] || {});
  } catch (err) { /* no saved positions */ }

  const first = tabs.find((t) => t.path === last) || tabs.find((t) => !t.file) || (notes[0] ? { path: notes[0].path } : null);
  if (first) {
    await openNote(first.path, true);
  } else {
    showNoteEditor(false);
    renderTabs();
  }
}

start();
