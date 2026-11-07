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
| `server.js` | Express server: notes API, task/event API, serves the frontend |
| `parser.js` | Finds tasks and events in markdown and edits those lines |
| `public/` | Frontend: `index.html`, `app.js`, `style.css` |
| `Dockerfile`, `docker-compose.yml` | Container and Portainer stack |
| `.github/workflows/build.yml` | Builds the image and updates the `deploy` branch |
