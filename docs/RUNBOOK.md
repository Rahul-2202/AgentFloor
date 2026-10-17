# AgentFloor runbook

How to keep offices running, and what to do when one isn't. **Admin dashboard:** `<web>/admin` (admins only), with every office, spend, machine hours, errors and the allowlist. **Health in one go:** `npm run live-check -w @agentfloor/infra`.

## How it fits together

- **Web** (Next.js, Railway) talks to the **API** (Fastify, Railway) and reads its own office's rows from **Supabase** (row-level security).
- Each office has one **machine** on **Daytona**, created from the office snapshot. Its daemon dials *out* to the API over the office link (`wss://<api>/office-link`) with the office token.
- The API stores the office's events, projects them into tables, runs Ada (Claude Agent SDK on the company Claude login), GitHub and Linear.
- The API ships the office code to the machine on every start: deploying the API updates offices the next time they start.

## Office machines

| Task | How |
| --- | --- |
| Start or resume | The CEO presses **Start** in the top bar (`POST /office/start`). An inactive snapshot is woken first (a minute or two). |
| Pause | **Pause** in the top bar. Containers stop; agents' sessions resume on the next start. Machines also stop by themselves after 15 quiet minutes. |
| See what's running | `/admin`, or `npm run live-check -w @agentfloor/infra` (lists running machines). |
| Stop everything (cost emergency) | In Daytona's dashboard, or the script below. Offices recover on their next Start. |

```bash
node -e 'import("@daytona/sdk").then(async ({Daytona})=>{const d=new Daytona();for await (const s of d.list()) { if (s.state==="started") { console.log("stopping",s.id); await s.stop(120); } }})'
```

### Recover a stuck office

Symptoms: the top bar says *Live*, but agents don't answer, or "The office didn't answer … in time".

1. Check `/admin`: is the office link **connected**, and are there errors for the office?
2. **Pause, then Start** from the top bar. The daemon restarts with the latest code. Agents keep their sessions and memory.
3. If an agent is stuck *On hold* (a take-over that never handed back, or a budget): open its card and press **Resume**, or release it from the live session.
4. If events stopped being stored (the transcript and statuses freeze while agents work): look for `projecting` errors in `/admin` or the API logs (`railway logs -s api`). Fix the cause, then restart the API (`railway redeploy -s api -y`). The office reconnects and the backlog is projected.
5. Still stuck: **rebuild from the snapshot** (below).

### Rebuild an office machine

The office's data (setup, tasks, threads, memory) lives in Supabase and the office's event log. The machine only holds working copies.

1. Pause the office.
2. Delete the machine in Daytona (dashboard, or `new Daytona().delete(sandbox)`).
3. Press **Start**: the API sees the machine is gone, creates a fresh one, gives it a new office token, and re-sends the setup. Agents' worktrees are recreated from the GitHub repo. Unpushed local work on the old machine is lost.

### A new office snapshot

`npm run snapshot -w @agentfloor/infra` builds `agentfloor-office-<version>-<sha>`. Set `OFFICE_SNAPSHOT` on the API service to the new name and redeploy; offices move to it when their machine is next recreated.

## Keys and secrets

All secrets live in Railway variables (and locally in `.env`), never in the repo.

| Secret | Where | Rotate |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | API | Supabase → API keys → new secret key → Railway → redeploy API. Linear webhook secrets derive from it: reconnect Linear afterwards. |
| `SUPABASE_PUBLISHABLE_KEY` | web | Supabase → API keys → Railway → redeploy web. |
| `DAYTONA_API_KEY` | API | Daytona → keys → Railway → redeploy API. |
| `AGENTFLOOR_CLAUDE_TOKEN` | API and the Daytona secret `agentfloor-claude-token` | `claude setup-token` → update both → redeploy API; restart offices. |
| `GITHUB_APP_PRIVATE_KEY` | API | GitHub → the app → Private keys → generate, update Railway, delete the old key. |
| `GITHUB_WEBHOOK_SECRET` | API, and the GitHub App's webhook | Change both together. |
| `LINEAR_API_KEY` | API | Linear → Settings → API → new key → Railway → redeploy. Webhooks keep working. |
| Office tokens | Per office (hash in Supabase) | A new one is issued whenever a machine is created; rebuilding the machine rotates it. |

## Backups

- **Database:** Supabase point-in-time recovery (Pro plan add-on). Restore from the Supabase dashboard → Database → Backups.
- **Office memory:** copied nightly at 03:00 UTC to the private `backups` bucket (`memory/<office>/<date>.json`, 30 days kept). Run it now from `/admin` → *Back up now*. The CEO can download their own from Company memory → *Export*.

## Errors and logs

- `/admin` lists errors from the web app, the API and offices, grouped by message, with counts, stacks and the office they came from.
- API logs: `railway logs -s api` (structured JSON from Fastify). Web logs: `railway logs -s web`.
- Office (daemon) problems are sent over the office link and show in `/admin` with source **office**.

## Access

The API only lets in people on the allowlist (GitHub login or email). Manage it in `/admin` → *Who may sign in*. Admins see `/admin`; the last admin can't be removed.
