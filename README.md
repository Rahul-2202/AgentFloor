# AgentFloor prototype

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

`config/office.json` is the default office: six agents in Development and
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
| `src/core/office.ts` | The protocol: threads, delivery points, rules, escalation, budgets |
| `src/core/tools.ts` | Every office call, defined once (HTTP, MCP and CLI all use it) |
| `src/core/store.ts` | SQLite (built into Node) |
| `src/daemon/` | HTTP API, server-sent events, startup |
| `src/mcp/server.ts` | The office as an MCP server, one per agent |
| `src/cli/office.ts` | The `office` shell command |
| `src/runtimes/` | Runtime adapter interface, supervisor, scripted runtime |
| `console/index.html` | The CEO console |

## Next

Tracked in Linear, project "AgentFloor Prototype":

- Phase 3: model gateway (cost, state, mid-task delivery for runtimes without hooks)
- Phase 4 + 5: conformance grid across runtimes, then a real shared-repo scenario
- Phase 6: run the office in a cloud sandbox (Daytona, see below)
