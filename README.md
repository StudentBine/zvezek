# Zvezek

Self-hosted markdown notes with a calendar where **tasks and events both show up**.
Notes are plain `.md` files in one folder, so they still open in any editor (or Obsidian).

## Writing tasks and events

Write them anywhere, in any note:

```markdown
- [ ] Push images to Docker Hub 📅 2026-11-10      task with a due date
- [ ] Kolokvij prep 📅 2026-11-12 14:00            task with a time
- [ ] Harden Vaultwarden                           task without a date (Tasks view only)
- Zagovor 📅 2026-11-18 09:30                      event (list item with a date, no checkbox)
```

`due:2026-11-10` works the same as `📅 2026-11-10`.

- **Calendar:** click the circle to tick a task, click the text to open its note, drag to change the date (the `.md` file is updated), click an empty day to add something.
- **Tasks:** grouped into Overdue, Today, Next 7 days, Later, No date and Done.
- **Notes:** autosave, folders (name a note `School/RIRS` to put it in a folder), search, `[[wiki links]]`.
- Quick add puts new items into `Inbox.md`.

## Numbered lists

Numbered lists can be nested. The file stays standard markdown (`1.` / `2.` at every level,
nesting by 4 spaces); the preview shows them as `1.` / `1.1.` / `1.1.1.`.

- **Enter** continues the numbering at the current level. Enter on an empty item steps out one level.
- **Tab** indents a line (with the lines nested under it) and restarts at `1.` under its parent. It only goes one level deeper than the line above.
- **Shift+Tab** outdents and continues the parent level's numbering.
- Numbers on both levels are fixed after each of these. Tab and Shift+Tab on bullets and `- [ ]` lines work as before.
- Numbered tasks work too: `1. [ ] Hand in report 📅 2026-11-20` shows in the calendar and Tasks view.

## Sidebar

- **Several notes:** Ctrl/Cmd+click toggles a note, Shift+click selects a range. With 2 or more selected, an action bar offers *Move to folder* (existing folder, top level, or a new one), *Delete* and *Clear* (Esc also clears). A move never overwrites a note that already exists in the target folder.
- **Hide:** the button at the top of the sidebar, or Ctrl/Cmd+`\`. A small bar at the top left switches views and brings the sidebar back.
- **Resize:** drag the right edge (200 to 480 px), double-click to reset, or focus the edge and use the arrow keys.
- Width and hidden state are remembered in the browser. The phone layout is not affected.

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
| `parser.js` | Finds tasks and events in markdown and edits those lines |
| `links.js` | Rewrites relative image links when a note moves to another folder |
| `public/` | Frontend: `index.html`, `app.js`, `style.css`, `lists.js` (numbered-list logic) |
| `Dockerfile`, `docker-compose.yml` | Container and Portainer stack |
| `.github/workflows/build.yml` | Builds the image and updates the `deploy` branch |
