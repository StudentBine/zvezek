# Zvezek

Self-hosted markdown notes with a calendar where **tasks and events both show up**.
Notes are plain `.md` files in one folder, so they still open in any editor (or Obsidian).

## Writing tasks and events

Write them anywhere, in any note:

```markdown
- [ ] Push images to Docker Hub due:2026-11-10     task with a due date
- [ ] Kolokvij prep due:2026-11-12 14:00           task with a time
- [ ] Harden Vaultwarden                           task without a date (Tasks view only)
- Zagovor due:2026-11-18 09:30                     event (list item with a date, no checkbox)
- [x] Hand in report due:2026-11-10 done:2026-11-08   a ticked task
```

Older notes with emoji (`📅 2026-11-10`, `🔁 every week`, `✅ 2026-11-08`, the Obsidian Tasks way) are still read.
Everything Zvezek writes uses the text spelling, and when it changes a line that has emoji (you tick it or drag it in the calendar) the whole line is converted.

In the editor and the preview, a due date is drawn as a quiet chip such as `Thu 12 Nov, 14:00`. On the line with the cursor you see the real text, and the file is never changed by this.

- **Calendar:** click the circle to tick a task, click the text to open its note, drag to change the date (the `.md` file is updated), click an empty day to add something. The calendar has no scrollbars of its own: the month grows to show every item of a day (a day only gets "+N more" from 9 items), and the week shows 06:00 to 24:00 (earlier items extend the range).
- **Tasks:** grouped into Overdue, Today, Next 7 days, Later, No date and Done.
- **Notes:** saved automatically (see *Saving*), folders (name a note `School/RIRS` to put it in a folder), search, `[[wiki links]]`.
- Quick add puts new items into `Inbox.md`.

## Categories

A category is a `#tag` on a task or event line: `- [ ] RIRS kolokvij #kolokvij due:2026-11-13` (the first tag counts, and a tag must start with a letter, so `#123` is not one). The tag is hidden in calendar and Tasks titles.

- **Settings:** add categories, pick one of 8 muted colours (dusk, sage, clay, heather, ash, sand, teal, rose), reorder with the arrows. They are saved in `.zvezek/settings.json`. Renaming a category does not rewrite your notes: it only changes which tag the colour belongs to.
- **Calendar:** tasks get a coloured checkbox, events a light tint. The toggles above the calendar show or hide categories (remembered in the browser).
- **Tasks:** *By date* or *By category* (remembered).
- **Edit from the calendar or Tasks view:** click an item (the round checkbox still ticks it) for a small popover with title, date, time, category, repeat and done, plus *Open note* and *Delete*. Saving rewrites only that line, and is refused with a message if the note changed in the meantime.
- **Add dialog:** has a Category field and a *Create more* box (remembered). When it is on, the dialog stays open after adding and only the text is cleared.

## Repeating tasks and events

```markdown
- [ ] Water plants repeat: every week due:2026-11-09
- Gym repeat: every monday, wednesday due:2026-11-09 18:00
- Standup repeat: every weekday until 2026-12-20 due:2026-11-09 09:30
```

The rules are the ones of the Obsidian Tasks plugin, and its emoji spelling (`🔁 every week 📅 2026-11-09`) is still read.

Rules: `every day`, `every N days`, `every week`, `every N weeks`, `every month`, `every N months`, `every year`,
`every weekday`, and lists like `every monday, thursday` (also `every 2 weeks on friday`). A series can end in one of two ways (use one of them):

```markdown
- Standup repeat: every weekday until 2026-12-20 due:2026-11-09 09:30    ends on that date (it can still be the last one)
- Course repeat: every week count 10 due:2026-11-09                       10 times in total, this one included
```

The Add dialog and the edit popover have an *Ends* option for this: Never, On date, After N times. Nothing is shown in the calendar after the end. `count` is "how many are left, counting this line": when you tick a task, the new line gets `count 9`, and ticking the last one (`count 1`) adds no new line.
A rule that is not understood is left alone: the line stays a normal item and the text stays in the title.

- **Events** show every occurrence in the visible calendar range. The line's own date is the first one.
- **Tasks:** only the line itself is a real task. The next 3 occurrences are shown faded in the calendar. When you tick it, that line gets `[x]` and `done:<today>`, and a new open line with the next date is inserted directly above it (the way Obsidian Tasks does it). The next date is counted from the due date, not from the day you tick. After the last date of an `until` series, or after the last `count`, no new line is added.
- Faded copies cannot be clicked, ticked or dragged. Dragging the real item moves the whole series (its `due:` date).
- Months: a date that does not exist in a month becomes the last day of it (the 31st gives Feb 28, then Mar 31). Note that when a repeating *task* is ticked, the next date is calculated from the previous one, so a 31st can settle on the 28th.
- The Add dialog has a *Repeat* select (none, every day, weekday, week, month, year).

## Tabs

Open notes are tabs above the editor. Clicking a note in the sidebar switches to its tab, or opens a new one.
The × and a middle click close a tab, a dot on the tab means unsaved changes (notes are saved before you switch or close), and tabs can be dragged to change the order.
Each tab remembers its cursor and scroll position, and the open tabs come back after a reload.
Renaming or moving a note updates its tab, deleting it closes the tab.

| Keys | |
| --- | --- |
| Alt+PageDown / Alt+PageUp | next / previous tab (Alt+Left/Right would clash with the editor and the browser's Back) |
| Alt+W | close the tab (Ctrl+W and Ctrl+Tab belong to the browser) |

## Preview

- ` ```mermaid ` blocks are drawn as diagrams (flowcharts, sequence diagrams, ...) in the preview and in side-by-side mode, in a light or dark theme to match the app. A broken diagram shows a short error and its source. The library (`mermaid`, served from `node_modules` at `/vendor/mermaid`) is only loaded when a note has a diagram.
- **Side by side** stays inside the normal page layout (it never goes fullscreen). The Side by side and Preview buttons each toggle on and off.
- Tables (with `:---:` alignment) scroll sideways when they are wider than the page. `---` and `***` make a horizontal line. The editor toolbar has Table and Horizontal line buttons.

## Files in the sidebar

Every file in the notes folder is listed (hidden files and folders are skipped), not only `.md`. Other files get an icon (pdf, image, archive, other), muted text and their size on hover.
A click opens `/files/<path>` in a new browser tab (PDFs and images are shown, zips download). They are never opened in the editor or searched for tasks.
They work with multi-select (move, delete) and the search matches their file names.

## Numbered lists

Numbered lists can be nested. The file stays standard markdown (`1.` / `2.` at every level,
nesting by 4 spaces); the preview shows them as `1.` / `1.1.` / `1.1.1.`.

- **Enter** continues the numbering at the current level. Enter on an empty item steps out one level.
- **Tab** indents a line (with the lines nested under it) and restarts at `1.` under its parent. It only goes one level deeper than the line above.
- **Shift+Tab** outdents and continues the parent level's numbering.
- Numbers on both levels are fixed after each of these. Tab and Shift+Tab on bullets and `- [ ]` lines work as before.
- Numbered tasks work too: `1. [ ] Hand in report due:2026-11-20` shows in the calendar and Tasks view.

## Viewing other files

Clicking a file in the sidebar opens it in a tab: images (click to zoom to 100%), PDFs (the browser's own viewer), text, code, JSON and logs (read-only) and CSV (as a table). Anything else, or a file bigger than the limit in Settings (25 MB by default), shows a card with its name, size and a Download button. `/files` still sends the sandbox header for SVG, HTML and XML; PDFs do not get it, because that would stop the PDF viewer.

## Live preview

In the editor, the marks of bold, italic, `~~strikethrough~~`, `code`, headings and quotes are hidden on every line except the one with the cursor. Turn it off in Settings. It only updates the lines that changed or that the cursor entered or left.

## Sidebar

- **Several notes:** Ctrl/Cmd+click toggles a note, Shift+click selects a range. With 2 or more selected, an action bar offers *Move to folder* (existing folder, top level, or a new one), *Delete* and *Clear* (Esc also clears). A move never overwrites a note that already exists in the target folder.
- **Hide the sidebar:** the button at the top of the sidebar, or Ctrl/Cmd+L (the browser's own "go to address bar" is switched off while Zvezek has focus). A small bar at the top left switches views and brings the sidebar back.
- **Resize:** drag the right edge (200 to 480 px), double-click to reset, or focus the edge and use the arrow keys.
- Width and hidden state are remembered in the browser. The phone layout is not affected.

- **Settings** (bottom of the sidebar): *Show Inbox in sidebar*. When it is off, `Inbox.md` is hidden from the list, quick add still writes to it, and search still finds it. Settings are saved in `DATA_DIR/.zvezek/settings.json` (a hidden folder), so they are the same on every device.

## Folders

- **New folder** (the folder button next to the + in the sidebar, or right-click a folder > *New subfolder*, or right-click the empty list). Empty folders stay in the sidebar and are kept on disk.
- **Drag and drop:** drag a note or file onto a folder to move it, or onto the top-level part of the list to move it out. Dragging a selected note takes the whole selection. A folder can be dragged onto another folder, but not into itself or its own subfolders. The folder under the mouse gets a ring while you drag.
- **Right-click a folder:** rename or move (type the new full path, for example `School/2027`), colour, hide, delete. A folder with files is only deleted after a question that says how many files are inside.
- **Colour:** the same 8 muted colours as categories, shown as a small coloured folder icon (not a coloured row).
- Moving a note keeps its relative image links working (as before). Moving a whole folder keeps links inside the folder as they are and fixes links that point outside it.
- Open tabs, hidden items and folder colours follow when things move or are renamed.

## Hiding notes

Right-click a note, file or folder > *Hide* (or *Hide* in the bar that appears when several are selected). Hidden items leave the sidebar but are still found by search, and their tasks stay in the calendar and Tasks view. In Settings: *Show hidden notes in the sidebar*, and the list of hidden items with an *Unhide* button for each. The list is part of `.zvezek/settings.json`, and a hidden item stays hidden when it is moved or renamed.

## Saving

- Every change is written at once to a local draft in the browser (`localStorage`).
- The note is sent to the server 2.5 seconds after you stop typing, and at least every 15 seconds while you keep typing. It is also saved when you switch tab, open another note, change view, leave the window, hide the page, or close it.
- If the server cannot be reached the draft stays, saving is tried again (2 s, 4 s, 8 s ... at most a minute), and the note header says *Offline, saved locally*. When saving works again the draft is removed. While everything is fine nothing is shown.
- When you open a note and a local draft is newer than the saved note, a small bar offers *Restore* or *Discard*. (The check compares the draft's time in your browser with the file's time on the server, so a very wrong clock on one of them can confuse it.)
- A note bigger than 64 KB cannot be sent in the last moment before the page closes (browser limit). Its draft is kept and offered next time.

## Full view

*Full view* in the note header, or Alt+Shift+F, hides the sidebar, the tabs and the header. Only the editor is left, centred (full width with side by side). The toolbar shows when the mouse is at the top or it has focus. Esc or the same shortcut leaves it.

## Side by side and width

Side by side uses the full width, with a draggable line between the editor and the preview (double-click it to reset; the place is remembered). In normal mode the text keeps a comfortable reading width; *Wide editor* in Settings turns that limit off.

## Keyboard shortcuts

(Cmd instead of Ctrl on a Mac.) The same list is in Settings.

| Shortcut | What it does |
| --- | --- |
| Ctrl+L | show or hide the sidebar (replaces Ctrl+\) |
| Alt+Shift+N / C / K | go to Notes / Calendar / Tasks |
| Alt+Shift+F | full view |
| Ctrl+S | save now |
| Alt+PageUp / Alt+PageDown, Alt+W | previous or next tab, close tab |
| Ctrl+B, Ctrl+I, Ctrl+K | bold, italic, link |
| Ctrl+Shift+8 / Ctrl+Shift+7 | bullet list / numbered list (the bullet list used to be Ctrl+L) |
| Ctrl+Shift+L | task list |
| Ctrl+P, F9 | preview, side by side |
| Tab / Shift+Tab | indent / outdent a list item |
| Esc | close a menu or popover, leave full view |

Why these: Alt+Shift+T would clash with "focus the toolbar" in Chrome, so Tasks is **K**. No Alt+digit, Ctrl+digit or Ctrl+Alt+T is used. Letters are read from the key you press, and the physical key is the fallback.

## Enter in lists

- An indented line that is not a list item: Enter starts the new line with no indent (inside a ``` code block the indent is kept).
- A list item with text: Enter continues the list at the same level (numbers too).
- An empty list item: Enter moves it out one level; at the top level the marker is removed and an empty line is left.

## Typing

Typing `(` `[` `{` `"` `'` or a backtick adds the closing partner and puts the cursor between them. With text selected it wraps the selection. Typing the closing character when it is already next to the cursor moves past it, and Backspace right after an opener removes the empty pair. A quote is not closed inside a word (`don't`) and a third backtick does not add a pair, so `[[wiki links]]`, `- [ ] ` tasks and code fences type as usual.

## Images

Files other than `.md` in the notes folder are served at `/files/<path>` (with the same login as the rest of the app).
In the preview, `![](img.png)` and `![](Folder/my%20image.png)` are relative to the folder of the open note,
so a Trilium Markdown export works as it is.

Renaming or moving a note to another folder rewrites its relative image links (`![](pics/a.png)`, `<img src="…">`) so they still point at the same files. The image files are not moved, and absolute URLs, `/files/` links and code blocks are left alone. A rename or move never overwrites an existing note: you get a "already exists" message instead.

## Deploy with Portainer (auto-updates)

How updates flow:

```
git push to main ──> GitHub Actions builds image ──> ghcr.io/studentbine/zvezek:latest
                                     └──> moves "deploy" branch to that commit
Portainer polls "deploy" branch ──> new commit ──> pulls new image, restarts container
```

Portainer watches `deploy` instead of `main` so it never redeploys before the new image exists.

### 1. Make the notes folder (on the server)

```bash
sudo mkdir -p /opt/appdata/zvezek
sudo chown 1001:100 /opt/appdata/zvezek
```

If your appdata lives somewhere else, use that path and set `NOTES_DIR` in step 3.

### 2. Make the image public (once)

After the first GitHub Actions run, open GitHub → your profile → **Packages** → `zvezek`
→ **Package settings** → **Change visibility** → Public.
(Or keep it private and add ghcr.io as a registry in Portainer with a token that has `read:packages`.)

### 3. Create the stack in Portainer

**Stacks → Add stack → Repository**

| Field | Value |
| --- | --- |
| Name | `zvezek` |
| Repository URL | `https://github.com/StudentBine/zvezek` |
| Repository reference | `refs/heads/deploy` |
| Compose path | `docker-compose.yml` |
| GitOps updates | On, mechanism **Polling**, interval `5m` |
| Re-pull image | On |

Environment variables (optional):

- `NOTES_DIR` — notes folder on the server (default `/opt/appdata/zvezek`)
- `APP_PASSWORD` — turns on a simple login prompt (user `admin`, or set `APP_USER`)

Deploy, then open `http://<server>:3010` to check it works.

### 4. Nginx Proxy Manager

Add a proxy host, for example `notes.lab.internal`:

- Forward hostname: `zvezek` (same `media` network), port `3000`
- Websockets support: not needed
- Use your internal CA certificate as for the other services

After that you can remove the `ports:` lines from `docker-compose.yml`.

## Running locally

```bash
npm install
DATA_DIR=./data npm start     # http://localhost:3000
```

## Backups

Everything is in the notes folder. Back up `/opt/appdata/zvezek` like any other folder,
or run `git init` inside it and commit from a cron job to get history.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Express server: notes API (including move/delete of several notes), task/event API, `/files`, serves the frontend |
| `parser.js` | Finds tasks and events in markdown, repeat rules, and edits those lines |
| `links.js` | Rewrites relative image links when a note moves to another folder |
| `public/` | Frontend: `index.html`, `app.js`, `style.css`, `lists.js` (numbered-list logic), `dates.js` (date chips) |

Repeat rules (`repeat:`) are parsed in `parser.js`, no library needed. The only runtime libraries from npm are `express`, `easymde`, `fullcalendar`, `mermaid` and the font and icon packages.
| `Dockerfile`, `docker-compose.yml` | Container and Portainer stack |
| `.github/workflows/build.yml` | Builds the image and updates the `deploy` branch |
