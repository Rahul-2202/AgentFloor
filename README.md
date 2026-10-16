# AgentFloor

Run a company of AI agents from a pixel office. This repo is a monorepo
(npm workspaces):

| Path | What |
| --- | --- |
| `packages/daemon` | The office daemon: protocol, agent runtimes, model gateway, CEO console. The prototype, and what runs in each office VM. |
| `packages/shared` | Types and catalogs shared by the daemon, the Control API and the web app |
| `supabase/` | Database schema (migrations), row-level security and its check |
| `apps/api` | The Control API (Fastify): verifies Supabase sign-ins, creates each person's office |
| `apps/web` | The web app (Next.js 16): GitHub sign-in; the pixel office comes in M6 |
| `infra/` | Builds the office VM snapshot on Daytona (`npm run snapshot -w @agentfloor/infra`) |
| `.railway/railway.ts` | Railway services `api` and `web` (staging deploys from `main`) |

Run commands from the repo root; `.env` lives at the root too.

## Web app and API

```bash
npm run dev -w @agentfloor/api   # http://localhost:4000
npm run dev -w @agentfloor/web   # http://localhost:3000, sign in with GitHub
```

In an office VM the daemon also dials out to the API's office link
(`AGENTFLOOR_LINK_URL`, `AGENTFLOOR_OFFICE_TOKEN`): it streams its events
(replaying anything the API missed) and answers the CEO's calls, which the web
app sends as `POST /office/call`.

What the API does for an office (M2):

- **Setup** (`/office/setup`, `/propose`, `/apply`, `/versions`): rooms, agents, policy and budgets,
  changed only through the policy engine (`apps/api/src/policy/engine.ts`). The read-back is
  written from the diff; applying needs the version the read-back was made from; any version can
  be restored. The office daemon gets every new version over the link and starts, stops or
  restarts agents to match.
- **Projection** (`apps/api/src/projection`): the office's event log becomes rows (threads,
  messages, tasks, inbox, agent status, usage with API-equivalent cost) that the web app reads
  under row-level security and follows with Supabase Realtime.
- **Budgets**: daily limits per office, room or agent; over the warning limit the CEO gets an
  inbox item, over the hard limit the agents in scope are put on hold until they're back under.
- **Live** (`/office/live` WebSocket): agents' session output as it happens, and taking over an
  agent's terminal (Daytona PTY) while the agent waits.
- **GitHub** (`/office/github`, `/office/prs/:n`): the GitHub App gives agents repo access with
  short-lived tokens for the office's repo only. Each agent works in its own worktree; agents open
  PRs, heads ask for merges, and only the CEO merges.

Ada, memory and governance (M3–M5):

- **Ada** (`apps/api/src/ada`): the office manager, on the Claude Agent SDK with the company's
  Claude login (`AGENTFLOOR_CLAUDE_TOKEN`). She chats with the CEO (streamed), runs the onboarding
  interview for a new office, triages the inbox, books meetings with pre-reads and writes their
  minutes, and writes a daily briefing. She changes the setup only by proposing read-back cards
  the CEO confirms; she can't touch locked rules or unlock them. `npm run check:ada -w @agentfloor/api`
  checks her live (one small Haiku run).
- **Memory** (`apps/api/src/memory`): layers (company, CEO preferences, room, agent, conversation,
  scratchpad) with owners and readers, versions, links, stale flags; lessons auto-accepted unless
  doubtful or conflicting; conversations, huddle agreements and the CEO's decisions become memory
  on their own; each agent's memory file is rewritten before every turn with its brief.
- **Governance**: permissions per agent and room (free, ask, never), enforced by a Claude Code
  PreToolUse hook; the first use of a powerful permission asks the CEO; when-blocked and drafts
  per room; locks; an audit trail.
- **Code updates**: on start, an office machine running other daemon code gets this deploy's code
  (its data stays), so releases reach existing offices without rebuilding them.

Office VMs (Daytona): with `DAYTONA_API_KEY` and `OFFICE_SNAPSHOT` set, the
API creates each office's VM on its first **Start office**, resumes it later,
and lets it pause after 15 quiet minutes (memory kept, agents carry on). The
Claude credential reaches the VM only as a Daytona secret limited to
`api.anthropic.com`.

Both read the root `.env` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`). The API checks its settings at start and names any
that are missing. Staging: https://web-staging-4faf.up.railway.app

## Database (Supabase)

```bash
npm run db:push    # apply new migrations in supabase/migrations to the linked project
npm run db:check   # check row-level security on the real project (rolls itself back)
```

Browsers only read, and only their own office's rows. Every write goes through
the Control API with the service role.

## The office daemon (prototype)

The office daemon and the agent-to-agent protocol. Agents never talk to each
other directly: every message goes through the daemon, which enforces the
rules, decides when each message is delivered, escalates unanswered questions,
and logs everything.

```
agent ──ask/reply (MCP or `office` CLI)──▶ office daemon ──delivers──▶ agent's own session
                                              │ rules · budgets · hop limits · escalation · log
                                              └──▶ console (CEO): threads, tasks, inbox
```

## Run it

```bash
npm install
npm run daemon          # opens http://127.0.0.1:4300/ with config/office.json
npm test                # protocol unit tests + end-to-end tests
```

`packages/daemon/config/office.json` is the default office: six agents in Development and
Marketing, all on **Claude Code with Haiku at low effort**, idle until you
message them or assign work from the console. Click an agent to see its live
session and its settings; change its runtime, model or effort there (with a
read-back, versioned, kept across restarts).

Other configs (`--config <file> --data <dir>`):

| Config | What it shows |
| --- | --- |
| `config/demo-scripted.json` | Scripted agents (no model, free) that play every protocol path |
| `config/live-claude.json` | Claude Code agents asking each other, answering from their own memory |
| `config/live-midtask.json` | A question reaching a busy agent mid-task |
| `config/live-mixed.json` | Claude Code, Junie and Antigravity in one office |

Delete the data folder (`data/` by default) to start fresh.

## Runtimes

| Runtime | Needs | Questions reach a busy agent |
| --- | --- | --- |
| Claude Code (default) | `claude auth login` | mid-task (PostToolUse hook) |
| Junie | `GEMINI_API_KEY` in `.env` | at the end of its turn, or via `wait` |
| Antigravity (`agy`) | Google sign-in (`agy`) | at the end of its turn, or via `wait` |
| Scripted | nothing | simulated |

Each agent works in `data/agents/<id>/work`, its own git repo with its memory
file (CLAUDE.md, .junie/guidelines.md, AGENTS.md/GEMINI.md) and office identity.

## Talking to the office

Every agent gets the same tools two ways:

| Tool | MCP | Shell |
| --- | --- | --- |
| Ask a question (non-blocking) | `ask` | `office ask <to> <question>` |
| Reply in a thread | `reply` | `office reply <thread> <text> [--resolve]` |
| Tell someone / a room / all | `inform` | `office inform <to\|room:<id>\|all> <text>` |
| Ask for work (via the head across rooms) | `request_work` | `office request-work <to> <title>` |
| Live back-and-forth | `huddle`, `end_huddle` | `office huddle …`, `office end-huddle …` |
| Ask the CEO (heads by default) | `ask_ceo` | `office ask-ceo <question>` |
| Read waiting messages | `inbox` | `office inbox` |
| Block until an answer (or a question) arrives | `wait` | `office wait [thread]` |
| Heads: halt an agent, assign work | `stop`, `create_task` | `office stop …`, `office create-task …` |
| Task progress | `update_task` | `office update-task <task> …` |

Messages arrive in the agent's session as an "Office message" block, with the
thread id and how to answer.

**Delivery:** questions, answers and huddle turns reach a busy agent after its
next tool call (runtimes with hooks) or when it calls `inbox`/`wait`; work and
FYIs wait for the end of its turn; `stop` interrupts.

## Try a real CLI by hand

Give an agent a runtime the office doesn't start yet (anything other than
`scripted`, e.g. `"runtime": "junie"`). The daemon still gives it an identity:

```bash
source data/agents/<id>/env     # AGENTFLOOR_URL, AGENTFLOOR_AGENT, AGENTFLOOR_TOKEN, PATH with `office`
office whoami
```

Then start the CLI in that shell, with the office MCP server
(`node --disable-warning=ExperimentalWarning <repo>/src/mcp/server.ts`) added to
its MCP config, or just tell it to use the `office` command.

## Run it in the cloud (Daytona)

Put `DAYTONA_API_KEY` and `AGENTFLOOR_CLAUDE_TOKEN` (from `claude setup-token`)
in `.env`, then:

```bash
npm run sandbox up       # create or wake the sandbox, push this repo, start the daemon
npm run sandbox status   # console link + daemon log
npm run sandbox down     # stop it (stops on its own after 30 idle minutes)
```

The sandbox is private: the console link opens only for your Daytona
organization. Only `AGENTFLOOR_CLAUDE_TOKEN` and `GEMINI_API_KEY` are copied
from your `.env`.

## Layout

| Path | What |
| --- | --- |
| `packages/daemon/src/core/office.ts` | The protocol: threads, delivery points, rules, escalation, budgets |
| `packages/daemon/src/core/tools.ts` | Every office call, defined once (HTTP, MCP and CLI all use it) |
| `packages/daemon/src/core/store.ts` | SQLite (built into Node) |
| `packages/daemon/src/daemon/` | HTTP API, server-sent events, startup |
| `packages/daemon/src/mcp/server.ts` | The office as an MCP server, one per agent |
| `packages/daemon/src/cli/office.ts` | The `office` shell command |
| `packages/daemon/src/runtimes/` | Runtime adapter interface, supervisor, scripted runtime |
| `packages/daemon/console/index.html` | The CEO console |

## Next

Tracked in Linear, project "AgentFloor Prototype":

- Phase 3: model gateway (cost, state, mid-task delivery for runtimes without hooks)
- Phase 4 + 5: conformance grid across runtimes, then a real shared-repo scenario
- Phase 6: run the office in a cloud sandbox (Daytona, see below)
