# Examples

This directory contains runnable examples that demonstrate the key features of the AI Agent Scheduling System.
Each example is a self-contained TypeScript file that can be executed directly with `tsx`.

## Prerequisites

1. Copy the root `.env.example` to `.env` and fill in your Google Gemini API key:

   ```bash
   cp .env.example .env
   # Edit .env and set GEMINI_API_KEY=<your-key>
   ```

2. Install dependencies (if you haven't already):

   ```bash
   npm install
   ```

## Running an Example

All examples are run from the **repository root** using `tsx`:

```bash
npx tsx examples/<filename>.ts
```

Or, if you have `tsx` installed globally:

```bash
tsx examples/<filename>.ts
```

---

## Examples

### 01 – Simple Agent

**File:** [`01-simple-agent.ts`](./01-simple-agent.ts)

The most basic usage of the system.  Creates a `GeminiClient`, defines an
agent with a name and task description, runs it once with `runAgent()`, and
prints the structured result.

```bash
npx tsx examples/01-simple-agent.ts
```

**Concepts covered:** `Agent`, `GeminiClient`, `runAgent`, `ExecutionResult`

---

### 02 – Agent with a System Prompt

**File:** [`02-agent-with-system-prompt.ts`](./02-agent-with-system-prompt.ts)

Runs the same task description through two agents – one with no system prompt
and one with a terse, technical persona – so you can see how a system prompt
shapes the LLM's response style.

```bash
npx tsx examples/02-agent-with-system-prompt.ts
```

**Concepts covered:** `systemPrompt`, response style tuning

---

### 03 – Agent with Built-in Tools

**File:** [`03-agent-with-tools.ts`](./03-agent-with-tools.ts)

Demonstrates how to give an agent access to the built-in tool registry so it
can gather live data before answering.  The agent uses the `current_time` and
`fetch_webpage_text` tools to produce a real-time Node.js release report.

Available built-in tools:

| Tool name            | Description                                               |
|----------------------|-----------------------------------------------------------|
| `current_time`       | Returns the current UTC timestamp                         |
| `http_get`           | Fetches a URL and returns the response body as text       |
| `fetch_rss`          | Fetches and parses an RSS or Atom feed                    |
| `fetch_json`         | Fetches a JSON API endpoint                               |
| `fetch_webpage_text` | Fetches a web page and returns stripped plain text        |

```bash
npx tsx examples/03-agent-with-tools.ts
```

**Concepts covered:** `ToolRegistry`, `createDefaultToolRegistry`, `tools` field, multi-turn tool calling

---

### 04 – Resilient Agent (Timeout & Retry)

**File:** [`04-resilient-agent.ts`](./04-resilient-agent.ts)

Shows how to configure per-agent timeout and exponential back-off retry
behaviour.  To observe retries, temporarily set `GEMINI_API_KEY` to an
invalid value or lower `timeoutMs` to a very small number.

```bash
npx tsx examples/04-resilient-agent.ts
```

**Concepts covered:** `timeoutMs`, `maxRetries`, `backoffBaseMs`, `RetryExhaustedError`

---

### 05 – Natural Language Schedule Parsing

**File:** [`05-nl-schedule-parsing.ts`](./05-nl-schedule-parsing.ts)

Translates plain-English schedule descriptions (e.g. _"every weekday at 9am"_)
into cron expressions via the LLM-backed parser, then prints the resulting cron
expression and a human-readable confirmation message.

```bash
npx tsx examples/05-nl-schedule-parsing.ts
```

Example output:

```
Input : "every weekday at 9am"
Cron  : 0 9 * * 1-5
Human : Every weekday (Monday–Friday) at 9:00 AM
Msg   : Schedule confirmed: Every weekday (Monday–Friday) at 9:00 AM (cron: 0 9 * * 1-5)
```

**Concepts covered:** `parseNaturalLanguageSchedule`, `isParsedSchedule`, `formatScheduleConfirmation`

---

### 06 – Agent Chaining

**File:** [`06-agent-chaining.ts`](./06-agent-chaining.ts)

Builds a two-agent pipeline where the first agent (Researcher) gathers raw
data and the second agent (Formatter) receives that output as context and
rewrites it for a non-technical audience.

The `previousOutput` parameter of `runAgent()` is used to pass data between
agents.  When using the database-backed scheduler, set the `chainTo` field on
an agent to its successor's name to trigger the chain automatically.

```bash
npx tsx examples/06-agent-chaining.ts
```

**Concepts covered:** `previousOutput`, `chainTo`, multi-agent pipelines

---

### 07 – Scheduled Agent (Cron + SQLite)

**File:** [`07-scheduled-agent.ts`](./07-scheduled-agent.ts)

Demonstrates the full scheduling pipeline using an in-memory SQLite database:

1. Opens a database and runs schema migrations.
2. Inserts an agent with the cron expression `* * * * *` (every minute).
3. Starts the `Scheduler`, which ticks periodically and runs any due agents.
4. Waits briefly, then shuts down gracefully and prints the execution history.

```bash
npx tsx examples/07-scheduled-agent.ts
```

**Concepts covered:** `openDatabase`, `runMigrations`, `insertAgent`, `Scheduler`, `drain()`

---

### 08 – Management REST API

**File:** [`08-rest-api.ts`](./08-rest-api.ts)

Demonstrates the full CRUD lifecycle of the built-in HTTP management API by
starting an `ApiServer` on an ephemeral port and exercising every endpoint:

| Method   | Path                          | Action                              |
|----------|-------------------------------|-------------------------------------|
| `POST`   | `/agents`                     | Create an agent                     |
| `GET`    | `/agents`                     | List all agents                     |
| `GET`    | `/agents/:id`                 | Get a specific agent                |
| `PATCH`  | `/agents/:id`                 | Update an agent's config            |
| `GET`    | `/agents/:id/executions`      | View execution history              |
| `GET`    | `/status`                     | System health and statistics        |
| `DELETE` | `/agents/:id`                 | Delete an agent                     |

```bash
npx tsx examples/08-rest-api.ts
```

**Concepts covered:** `ApiServer`, REST API, `scheduleInput` (cron or natural language)

---

## Practical Use-Case Examples

The examples above cover individual features.  Here are a few ideas that
combine them for real-world automation scenarios:

### Morning Briefing
Create an agent that runs `0 7 * * *` (every day at 7 AM), uses the
`fetch_rss` and `fetch_webpage_text` tools to pull news and calendar data,
and sends the summary to your inbox via `emailRecipient`.

### Weekly Dependency Watch
Create an agent that runs `0 8 * * 1` (every Monday at 8 AM), uses
`http_get` or `fetch_json` to check your project's key dependencies for
new releases on the npm registry, and emails you a structured summary.

### Incident Digest
Create an agent that runs `0 */4 * * *` (every four hours), uses
`fetch_webpage_text` to check status pages (AWS, GitHub, npm, etc.), and
emails you only when active incidents are detected.

### Tech Radar
Create an agent that runs `0 8 * * 1` (every Monday at 8 AM), uses
`fetch_rss` to pull the latest posts from Hacker News and tech blogs, and
delivers a curated weekly summary.

See [`07-scheduled-agent.ts`](./07-scheduled-agent.ts) and
[`08-rest-api.ts`](./08-rest-api.ts) for how to register an agent with a
schedule and email delivery in code, or use the REST API from the running
service to create agents without touching source files.
