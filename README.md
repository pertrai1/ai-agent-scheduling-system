# AI Agent Scheduling System

An AI-powered agent scheduling system that runs LLM-backed tasks automatically on a cron schedule and delivers results by email. Define named agents with task descriptions and schedules; the system handles execution, retries, email delivery, and health monitoring.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the Service](#running-the-service)
- [Configuration Reference](#configuration-reference)
- [Management API](#management-api)
  - [Agents](#agents)
  - [Executions](#executions)
  - [Status](#status)
- [Scheduling](#scheduling)
- [Resilience (Timeout & Retry)](#resilience-timeout--retry)
- [Email Notifications](#email-notifications)
- [Tool Execution (MCP)](#tool-execution-mcp)
- [External Data Sources](#external-data-sources)
- [Agent Chaining](#agent-chaining)
- [Development](#development)

---

## Features

- **Cron scheduling** — runs agents on any five-field cron expression.
- **Natural language scheduling** — describe schedules in plain English ("every weekday at 9am") and the system converts them via the LLM.
- **LLM integration** — uses Google Gemini to execute each agent's task.
- **Tool/skill execution** — agents can call built-in tools (`current_time`, `http_get`, `fetch_rss`, `fetch_json`, `fetch_webpage_text`) via Gemini's function-calling API.
- **External data sources** — built-in tools for fetching RSS/Atom feeds, JSON APIs, and web page text let agents pull live data before processing it with the LLM.
- **Agent chaining** — the output of one agent can be fed as input to another, enabling multi-step pipelines.
- **Resilience** — configurable per-agent timeout, retry count, and exponential back-off with jitter.
- **Email notifications** — sends success and failure emails independently of agent execution.
- **REST API** — full CRUD management of agents and execution history.
- **Observability** — structured JSON logging, rolling execution history, aggregate metrics, and unhealthy-agent detection.
- **Graceful shutdown** — SIGTERM/SIGINT drains in-flight jobs, stops the API server, and closes the database cleanly.
- **Idempotency guard** — prevents duplicate runs if the process restarts mid-minute.
- **Concurrency control** — configurable limit on simultaneous LLM calls.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         index.ts                                │
│  Entry point: loads config, runs migrations, starts scheduler   │
│  and API server, registers graceful shutdown handlers.          │
└──────────┬──────────────────────────────┬───────────────────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐      ┌───────────────────────────────────┐
│   Scheduler          │      │  ApiServer (HTTP REST)            │
│  (scheduler.ts)      │      │  (apiServer.ts)                   │
│                      │      │                                   │
│  • Minute-aligned    │      │  POST   /agents                   │
│    tick loop         │      │  GET    /agents                   │
│  • isAgentDueNow()   │      │  GET    /agents/:id               │
│  • Idempotency guard │      │  PATCH  /agents/:id               │
│  • Semaphore for     │      │  DELETE /agents/:id               │
│    concurrency       │      │  GET    /agents/:id/executions    │
│  • drain() for       │      │  GET    /status                   │
│    graceful shutdown │      └──────────────┬────────────────────┘
└──────────┬───────────┘                     │
           │                                 │
           ▼                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Core Modules                               │
│                                                                  │
│  runAgent.ts       — orchestrates LLM call with retry/timeout    │
│  retryRunner.ts    — withRetry, withTimeout, calculateBackoff    │
│  geminiClient.ts   — Google Gemini API wrapper                   │
│  promptBuilder.ts  — composes system prompt + task description   │
│  emailNotifier.ts  — sends success/failure emails via SMTP       │
│  nlScheduleParser.ts — natural language → cron via LLM           │
│  cronValidator.ts  — validates five-field cron expressions       │
│  observability.ts  — metrics, unhealthy detection, status        │
│  logger.ts         — structured JSON logger                      │
│  errors.ts         — centralized error types + HTTP mapping      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Persistence Layer                             │
│                                                                 │
│  database.ts       — SQLite helpers (dbRun, dbGet, dbAll)       │
│  migrations.ts     — idempotent schema migrations               │
│  agentRepository.ts — CRUD for agents + execution history       │
│                                                                 │
│  Tables: agents, executions                                     │
│  Rolling history cap: last 100 executions per agent             │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|---|---|
| `index.ts` | Boot sequence, health logging, graceful shutdown |
| `scheduler.ts` | Minute-aligned cron tick, idempotency guard, concurrency semaphore, drain on shutdown, agent chaining |
| `apiServer.ts` | HTTP REST API — agent CRUD, execution history, status endpoint |
| `runAgent.ts` | Wraps LLM call in retry/timeout logic, records `durationMs`, supports `previousOutput` for chaining |
| `retryRunner.ts` | `withRetry`, `withTimeout`, `calculateBackoffDelay` (exponential + jitter) |
| `geminiClient.ts` | Thin wrapper around `@google/generative-ai` — supports plain text and multi-turn function calling |
| `promptBuilder.ts` | Merges `systemPrompt`, `taskDescription`, and optional `previousOutput` into a single prompt |
| `emailNotifier.ts` | SMTP email sending with independent retry and logging |
| `nlScheduleParser.ts` | LLM-backed natural language → cron conversion with Zod validation |
| `cronValidator.ts` | Validates five-field cron expressions using `cron-parser` |
| `observability.ts` | Aggregate metrics, unhealthy detector, upcoming-run calculator, system status |
| `logger.ts` | `structuredLog` (JSON), `truncate`, execution lifecycle helpers |
| `errors.ts` | `AppError` hierarchy, `errorToHttpStatus`, `errorToMessage` |
| `toolRegistry.ts` | `ToolRegistry` class — register, execute, and introspect tool definitions |
| `builtinTools.ts` | Built-in tools: `current_time`, `http_get`, `fetch_rss`, `fetch_json`, `fetch_webpage_text`; `createDefaultToolRegistry()` factory |
| `dataFetcher.ts` | External data fetch helpers — RSS/Atom feed parsing, JSON API fetching, web page text extraction |
| `database.ts` | Promise-based SQLite helpers |
| `migrations.ts` | Idempotent `CREATE TABLE` and `ALTER TABLE` migrations |
| `agentRepository.ts` | CRUD for `agents` and `executions`, null→undefined normalization |
| `config.ts` | Zod-validated config loader (`loadConfig`) |

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **Google Gemini API key** (get one at [ai.google.dev](https://ai.google.dev))
- An **SMTP server** for email (or a local tool like [Mailpit](https://mailpit.axllent.org/) for development)

---

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/pertrai1/ai-agent-scheduling-system.git
   cd ai-agent-scheduling-system
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set at minimum:

   ```dotenv
   GEMINI_API_KEY=your-api-key-here
   ```

   See [Configuration Reference](#configuration-reference) for all options.

---

## Running the Service

### Development (with hot-reload)

```bash
npm run dev
```

### Production

```bash
npm run build   # compile TypeScript → dist/
npm run start   # run compiled output
```

On startup the service:
1. Validates configuration.
2. Opens the SQLite database (`agents.db` by default, overridable with `DB_PATH`).
3. Runs idempotent migrations.
4. Starts the cron scheduler (aligns to the next whole-minute boundary).
5. Starts the REST API server.

---

## Configuration Reference

Copy `.env.example` to `.env` and set the values below.

| Variable | Default | Required | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | — | ✅ | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-1.5-flash` | | Gemini model name |
| `SMTP_HOST` | `localhost` | | SMTP server hostname |
| `SMTP_PORT` | `1025` | | SMTP server port |
| `SMTP_USER` | *(empty)* | | SMTP username |
| `SMTP_PASS` | *(empty)* | | SMTP password |
| `EMAIL_FROM` | `noreply@example.com` | | Sender address for notifications |
| `PORT` | `3000` | | HTTP API port |
| `NODE_ENV` | `development` | | `development` or `production` |
| `LOG_LEVEL` | `info` | | Log level (`debug`, `info`, `warn`, `error`) |
| `DB_PATH` | `agents.db` | | Path to the SQLite database file |

---

## Management API

The REST API listens on `http://localhost:3000` by default.

### Agents

#### List all agents

```http
GET /agents
```

Returns an array of all registered agents with their current configuration and `lastRunAt` timestamp.

#### Create an agent

```http
POST /agents
Content-Type: application/json

{
  "name": "Morning Briefing",
  "taskDescription": "Summarise the top technology news stories from the past 24 hours.",
  "systemPrompt": "Be concise and use bullet points.",
  "scheduleInput": "0 7 * * *",
  "enabled": true,
  "emailRecipient": "user@example.com",
  "timeoutMs": 30000,
  "maxRetries": 3,
  "backoffBaseMs": 1000,
  "tools": ["http_get", "current_time"],
  "chainTo": "Digest Sender"
}
```

`scheduleInput` accepts either a valid five-field cron expression (`0 7 * * *`) or a natural language description (`"every day at 7am"`). The LLM is used to parse natural language; an error is returned if the input cannot be resolved.

Returns `201 Created` with the stored agent on success.

#### Get an agent

```http
GET /agents/:id
```

Returns `404` if the agent does not exist.

#### Update an agent

```http
PATCH /agents/:id
Content-Type: application/json

{
  "enabled": false,
  "scheduleInput": "0 9 * * 1-5"
}
```

All fields are optional. Changes take effect on the next scheduler tick without a restart.

#### Delete an agent

```http
DELETE /agents/:id
```

Returns `204 No Content` on success. Future scheduled runs are cancelled immediately.

### Executions

#### List execution history for an agent

```http
GET /agents/:id/executions
```

Returns up to the last 100 executions in descending order, each including:

| Field | Type | Description |
|---|---|---|
| `id` | number | Execution ID |
| `agentId` | number | Parent agent ID |
| `agentName` | string | Agent name at time of run |
| `ranAt` | string (ISO 8601) | Scheduled run time |
| `status` | `"success"` \| `"failure"` | Outcome |
| `response` | string? | LLM response (success) |
| `error` | string? | Error message (failure) |
| `attempts` | number? | Total attempts made |
| `durationMs` | number? | Wall-clock execution duration |

### Status

```http
GET /status
```

Returns a system health snapshot:

```json
{
  "registeredAgents": 3,
  "enabledAgents": 2,
  "upcomingRuns": [
    { "agentId": 1, "agentName": "Morning Briefing", "nextRunAt": "2026-01-02T07:00:00.000Z" }
  ],
  "agentMetrics": [
    {
      "agentId": 1,
      "agentName": "Morning Briefing",
      "totalRuns": 10,
      "successCount": 9,
      "failureCount": 1,
      "successRate": 0.9,
      "avgDurationMs": 4200
    }
  ],
  "unhealthyAgents": []
}
```

An agent appears in `unhealthyAgents` when its last three consecutive executions all failed.

---

## Scheduling

Schedules are specified as standard five-field cron expressions:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

Common examples:

| Expression | Meaning |
|---|---|
| `* * * * *` | Every minute |
| `0 7 * * *` | Every day at 7:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 8 * * 1` | Every Monday at 8:00 AM |
| `0 */3 * * *` | Every 3 hours |
| `0 9,18 * * *` | Twice a day (9 AM and 6 PM) |
| `0 8 1-7 * 1` | First Monday of every month at 8 AM |

You can also pass natural language in `scheduleInput` when creating or updating an agent, and the system will convert it to a cron expression using the configured LLM.

---

## Resilience (Timeout & Retry)

Each agent has three resilience settings:

| Field | Default | Description |
|---|---|---|
| `timeoutMs` | `60000` | Maximum milliseconds for a single LLM call |
| `maxRetries` | `3` | Additional attempts after the first failure |
| `backoffBaseMs` | `1000` | Base delay for exponential back-off |

Retry delay formula: `min(backoffBaseMs × 2^attempt, 60000) + random jitter (up to 20%)`.

After all retries are exhausted, the failure is recorded and the next scheduled run proceeds normally.

---

## Email Notifications

Set `emailRecipient` on an agent to receive execution results by email.

- **Success email** — subject: `[Agent] <name> succeeded`, body includes timestamp and full LLM response.
- **Failure email** — subject: `[Agent] <name> failed`, body includes error details and attempt count.

Email delivery is retried independently of agent execution; a delivery failure does not affect the agent's execution status.

Configure SMTP via the environment variables in [Configuration Reference](#configuration-reference). For local development, [Mailpit](https://mailpit.axllent.org/) captures emails without sending them.

---

## Tool Execution (MCP)

Agents can call built-in tools during LLM execution via Gemini's function-calling API (Model Context Protocol style). This allows an agent to fetch live data before generating its response.

### Built-in tools

| Tool | Description |
|---|---|
| `current_time` | Returns the current date and time in ISO 8601 format (UTC) |
| `http_get` | Performs an HTTP GET to a URL and returns the response body (truncated to 10,000 characters) |
| `fetch_rss` | Fetches an RSS 2.0 or Atom 1.0 feed and returns parsed items as JSON |
| `fetch_json` | Fetches a JSON API endpoint with optional headers and returns formatted JSON (truncated to 10,000 characters) |
| `fetch_webpage_text` | Fetches a web page and returns stripped plain text (truncated to 10,000 characters) |

### Enabling tools on an agent

Set the `tools` field to an array of tool names when creating or updating an agent:

```http
POST /agents
Content-Type: application/json

{
  "name": "Dependency Watch",
  "taskDescription": "Fetch https://api.example.com/releases and summarise new versions.",
  "tools": ["http_get", "current_time"],
  "cronExpression": "0 8 * * 1",
  "enabled": true
}
```

When the agent runs, the scheduler resolves the tool names against the registry and invokes `generateWithTools`, which drives a multi-turn Gemini function-calling loop (up to 10 rounds) until the model returns a final text response. Unrecognised tool names are skipped with a warning.

### How it works

1. The scheduler calls `runAgent` with the agent's `tools` list and a `ToolRegistry`.
2. `runAgent` resolves the tool names to `ToolDefinition` objects (Zod-validated JSON Schema).
3. `GeminiClient.generateWithTools` sends the definitions to the Gemini API.
4. When the model emits a function call, the executor looks up and invokes the registered handler.
5. The tool result is fed back to the model; this repeats until the model returns plain text.

### Adding custom tools

```typescript
import { ToolRegistry } from "./toolRegistry";

const registry = new ToolRegistry();
registry.register(
  {
    name: "my_tool",
    description: "Does something useful",
    parameters: {
      type: "object",
      properties: { input: { type: "string", description: "Input value" } },
      required: ["input"],
    },
  },
  async (args) => {
    const result = await doSomething(String(args.input));
    return result;
  }
);
```

Pass the registry to `Scheduler` as the fifth constructor argument:

```typescript
const scheduler = new Scheduler(db, geminiClient, config, maxConcurrent, registry);
```

---

## External Data Sources

Agents can pull live data from external sources before the LLM processes it, using three dedicated built-in tools. This turns agents from simple prompt runners into genuine automation tools that act on up-to-date information.

### `fetch_rss` — RSS and Atom feeds

Fetches and parses an RSS 2.0 or Atom 1.0 feed, returning a structured JSON object containing the feed title, description, link, and up to `max_items` entries (default: 20). Each entry includes `title`, `link`, `description`, `pubDate`, and `guid`.

```http
POST /agents
Content-Type: application/json

{
  "name": "Tech News Digest",
  "taskDescription": "Use fetch_rss to read https://hnrss.org/frontpage and summarise the top 5 technology stories.",
  "tools": ["fetch_rss"],
  "cronExpression": "0 8 * * 1-5",
  "enabled": true,
  "emailRecipient": "user@example.com"
}
```

Tool parameters:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✅ | URL of the RSS or Atom feed |
| `max_items` | number | | Maximum number of feed items to return (default: 20) |

### `fetch_json` — JSON APIs

Fetches any JSON API endpoint and returns the response as a formatted JSON string (truncated to 10,000 characters). Supports optional HTTP request headers for authenticated APIs.

```http
POST /agents
Content-Type: application/json

{
  "name": "GitHub Release Watch",
  "taskDescription": "Use fetch_json to call https://api.github.com/repos/nodejs/node/releases/latest and report the latest Node.js release.",
  "tools": ["fetch_json"],
  "cronExpression": "0 9 * * 1",
  "enabled": true
}
```

Tool parameters:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✅ | The API endpoint URL |
| `headers` | string | | JSON object string of HTTP headers, e.g. `'{"Authorization":"Bearer token"}'` |

### `fetch_webpage_text` — Web page text

Fetches a web page and extracts readable plain text by stripping all HTML tags, scripts, and styles (truncated to 10,000 characters). Useful for scraping documentation, release notes, or status pages.

```http
POST /agents
Content-Type: application/json

{
  "name": "Status Page Monitor",
  "taskDescription": "Use fetch_webpage_text to read https://www.githubstatus.com and report any active incidents.",
  "tools": ["fetch_webpage_text", "current_time"],
  "cronExpression": "0 */4 * * *",
  "enabled": true,
  "emailRecipient": "ops@example.com"
}
```

Tool parameters:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | ✅ | The URL of the web page to fetch |

### Combining external data tools with chaining

External data tools work well at the head of an agent chain. A data-gathering agent fetches and formats raw content; a downstream summarisation agent receives the output as context and produces the final report:

```http
POST /agents   (agent 1)
{
  "name": "Hacker News Fetcher",
  "taskDescription": "Use fetch_rss to read https://hnrss.org/frontpage with max_items 10 and return the raw feed items.",
  "tools": ["fetch_rss"],
  "cronExpression": "0 7 * * *",
  "enabled": true,
  "chainTo": "Hacker News Summariser"
}

POST /agents   (agent 2)
{
  "name": "Hacker News Summariser",
  "taskDescription": "Write a concise morning briefing from the feed items above.",
  "emailRecipient": "user@example.com"
}
```

### Implementation details

The external data fetch helpers live in `src/dataFetcher.ts` and are exposed as tools registered in `createDefaultToolRegistry()` (`src/builtinTools.ts`). All three tools:

- Use the native `fetch` API (Node.js ≥ 18).
- Throw descriptive errors on non-OK HTTP responses.
- Truncate large responses to avoid overwhelming the LLM context window.
- Are fully unit-tested with mocked network calls (`src/__tests__/dataFetcher.test.ts`).

---

## Agent Chaining

Agent chaining lets you connect agents in a pipeline: when agent A completes successfully, its LLM output is automatically passed as context to agent B.

### Configuring a chain

Set the `chainTo` field to the **name** of the downstream agent:

```http
POST /agents
Content-Type: application/json

{
  "name": "Researcher",
  "taskDescription": "Fetch the latest AI research papers from https://arxiv.org/list/cs.AI/recent and extract the five most relevant titles and abstracts.",
  "tools": ["http_get"],
  "cronExpression": "0 7 * * 1-5",
  "enabled": true,
  "chainTo": "Summariser"
}
```

```http
POST /agents
Content-Type: application/json

{
  "name": "Summariser",
  "taskDescription": "Write a concise executive summary of the research papers.",
  "enabled": true
}
```

When `Researcher` runs, its response is prepended to `Summariser`'s prompt:

```
Previous agent output:
<Researcher's LLM response>

Write a concise executive summary of the research papers.
```

### Chain execution behaviour

- Chained agents run **inline** in the same scheduler tick, sequentially.
- The downstream agent's own `cronExpression` is **not** evaluated for chained runs — only the head of the chain needs a schedule.
- The downstream agent still gets its own execution record in the database.
- If the upstream agent **fails**, the chain is **not** triggered.
- **Circular chains** (A → B → A) are detected by a depth limit of 10 hops; the chain is aborted with a warning log when the limit is reached.
- If the `chainTo` target agent does not exist, a warning is logged and the chain stops silently.

---

## Development

### Available scripts

```bash
npm run dev    # run with tsx (no compile step)
npm run build  # compile TypeScript → dist/
npm run start  # run compiled dist/index.js
npm run test   # run all tests with Vitest
npm run lint   # typecheck only (tsc --noEmit)
```

### Running tests

Tests use in-memory SQLite and mock the Gemini client — no `.env` file needed:

```bash
npm test
```

### Project structure

```
src/
├── __tests__/         # Vitest test files
├── agent.ts           # Zod schemas: Agent, ExecutionResult
├── agentRepository.ts # SQLite CRUD for agents + executions
├── apiServer.ts       # HTTP REST API
├── builtinTools.ts    # Built-in tools: current_time, http_get, fetch_rss, fetch_json, fetch_webpage_text
├── config.ts          # Zod-validated config loader
├── cronValidator.ts   # Cron expression validator
├── database.ts        # SQLite promise helpers
├── dataFetcher.ts     # External data fetch: RSS/Atom, JSON API, web page text
├── emailNotifier.ts   # SMTP email sender
├── errors.ts          # Centralized error types
├── geminiClient.ts    # Google Gemini client wrapper (text + tools)
├── index.ts           # Application entry point + graceful shutdown
├── logger.ts          # Structured JSON logger
├── migrations.ts      # Database migrations
├── nlScheduleParser.ts# Natural language → cron parser
├── observability.ts   # Metrics, health, status snapshot
├── promptBuilder.ts   # LLM prompt construction (supports previousOutput)
├── retryRunner.ts     # Timeout, retry, back-off
├── runAgent.ts        # Agent execution orchestrator
├── scheduler.ts       # Cron scheduler with idempotency + semaphore + chaining
└── toolRegistry.ts    # Tool registry and ToolDefinition schema
```

