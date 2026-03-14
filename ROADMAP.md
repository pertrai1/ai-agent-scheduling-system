# AI Agent Scheduling System Roadmap

This roadmap breaks the challenge into small, atomic tasks that can be implemented and validated independently.

## Phase 0: Project Setup (Step Zero)

- [x] Initialize Node.js + TypeScript project (`tsconfig`, `src` folder).
- [x] Add core dependencies: `zod`, `dotenv`, `sqlite3` (or chosen SQLite client), cron parser/scheduler library.
- [x] Add dev dependencies: `typescript`, `tsx`, `vitest` (or Jest), `@types/node`, lint/format tools.
- [x] Create environment file template (`.env.example`) with Gemini and email placeholders.
- [x] Add `npm` scripts for `dev`, `build`, `start`, `test`, and `lint`.
- [x] Create a minimal app entrypoint that starts and logs service health.
- [x] Add a config module to load and validate env vars with Zod.
- [x] Verify project boots with no runtime/config validation errors.

## Phase 1: Core Agent Execution (Step 1)

- [x] Define `Agent` schema (name, taskDescription, optional systemPrompt).
- [x] Define `ExecutionResult` schema (agentName, ranAt, status, response, error).
- [x] Create Gemini client wrapper with a single `generateText` method.
- [x] Implement prompt builder combining `systemPrompt` and `taskDescription`.
- [x] Implement `runAgent(agent)` returning structured success/failure result.
- [x] Catch and normalize LLM errors into a consistent error object/string.
- [x] Add manual run command/function for a single agent.
- [x] Add test: simple summarization agent returns success structure.
- [x] Add test: system prompt changes response style.
- [x] Add test: impossible task returns graceful result without crashing.

## Phase 2: Persistence Foundation (Needed Before Scheduling Scale)

- [x] Create SQLite connection module.
- [x] Add migration runner setup.
- [x] Create `agents` table migration.
- [x] Create `executions` table migration.
- [x] Add repository function: insert agent.
- [x] Add repository function: fetch agent by id/name.
- [x] Add repository function: list agents.
- [x] Add repository function: update agent fields.
- [x] Add repository function: delete agent.
- [x] Add repository function: insert execution record.
- [x] Add repository function: list execution history by agent.
- [x] Add startup check that migrations run successfully.

## Phase 3: Cron Scheduling Engine (Step 2)

- [x] Extend agent schema with `cronExpression` and `enabled` flag.
- [x] Add cron expression validator utility.
- [x] Implement scheduler tick loop (minute-level check).
- [x] Implement `isAgentDueNow(agent, now)` function.
- [x] Implement concurrent execution for multiple due agents.
- [x] Ensure one agent failure does not block other agent runs.
- [x] Add last-run tracking update after each execution.
- [x] Add startup behavior to load enabled agents into scheduler.
- [x] Add test: `* * * * *` runs once per minute.
- [x] Add test: two agents due same minute both execute.
- [x] Add test: disabled agent does not execute.
- [x] Add test: re-enabled agent resumes execution.
- [x] Add test: `*/5 * * * *` timing logic is correct.

## Phase 4: Natural Language Scheduling (Step 3)

- [x] Create parser interface: natural language input -> cron output.
- [x] Implement NL parsing strategy (LLM or library-backed).
- [x] Add strict post-parse cron validation.
- [x] Add human-readable schedule description generator.
- [x] Add parse response shape: `cron`, `description`, `confidence/notes`.
- [x] Return explicit parse error for ambiguous or unparseable input.
- [x] Add confirmation flow to show interpreted cron before save.
- [x] Add test: "every day at 7am" -> `0 7 * * *`.
- [x] Add test: "every weekday at 9am" -> `0 9 * * 1-5`.
- [x] Add test: "every Monday at 8am" -> `0 8 * * 1`.
- [x] Add test: "every 3 hours" -> `0 */3 * * *`.
- [x] Add test: "twice a day" resolves to valid expected schedule.
- [x] Add test: ambiguous text returns clear actionable error.

## Phase 5: Resilience (Timeout + Retry) (Step 4)

- [x] Extend agent config with `timeoutMs`, `maxRetries`, `backoffBaseMs`.
- [x] Add default settings (e.g., timeout 60s, retries 3).
- [x] Wrap LLM execution with timeout controller.
- [x] Create retry runner utility with exponential backoff + jitter.
- [x] Retry only transient failures/timeouts (or configurable policy).
- [x] Record attempt count and final outcome in execution record.
- [x] Ensure exhausted failures are marked permanent failure.
- [x] Ensure failed run does not block next scheduled run.
- [x] Add test: timeout triggers retry sequence.
- [x] Add test: failing call retries exact configured count.
- [x] Add test: backoff delays increase across attempts.
- [x] Add test: success on first attempt performs zero retries.
- [x] Add test: next schedule still runs after permanent failure.

## Phase 6: Email Notifications (Step 5)

- [x] Add email config schema (provider/SMTP host, port, auth, sender).
- [x] Add email client abstraction (`sendSuccess`, `sendFailure`).
- [x] Add agent field `emailRecipient`.
- [x] Implement success email template (subject, timestamp, formatted output).
- [x] Implement failure email template (error details + metadata).
- [x] Trigger email send after agent execution completes.
- [x] Decouple email retry from agent execution retry.
- [x] Add email-delivery retry policy and logging.
- [x] Add test: success execution sends properly formatted email.
- [x] Add test: failed execution sends failure email.
- [x] Add test: broken email config does not fail agent execution.
- [x] Add test: email delivery retries and logs failures.

## Phase 7: Management Interface (Step 6)

- [ ] Choose interface mode (REST API, CLI, or both).
- [ ] Implement create-agent endpoint/command.
- [ ] Implement list-agents endpoint/command with status fields.
- [ ] Implement get-agent-details endpoint/command.
- [ ] Implement update-agent endpoint/command.
- [ ] Implement delete-agent endpoint/command.
- [ ] Support schedule input as cron or natural language.
- [ ] Validate timeout/retry/email fields on create/update.
- [ ] Persist all config updates in SQLite.
- [ ] Wire scheduler to pick up create/update/delete changes without restart.
- [ ] Implement execution history endpoint/command per agent.
- [ ] Add test: create agent then verify scheduled execution starts.
- [ ] Add test: edit schedule and verify new timing takes effect.
- [ ] Add test: delete agent stops future runs.
- [ ] Add test: restart service preserves agents and execution history.

## Phase 8: Observability + Health (Step 7)

- [ ] Add structured logger for execution lifecycle events.
- [ ] Log fields: agent name, start time, duration, status, retries, summary/error.
- [ ] Implement response/error truncation helper for logs.
- [ ] Enforce rolling execution history cap (last 100 per agent).
- [ ] Implement aggregate metrics calculator (count, success rate, avg duration).
- [ ] Implement unhealthy detector (last 3 consecutive failures).
- [ ] Implement status endpoint/command with:
- [ ] Registered agent count.
- [ ] Enabled agent count.
- [ ] Upcoming scheduled runs.
- [ ] Aggregate execution metrics.
- [ ] Unhealthy agents list.
- [ ] Add test: status reflects registered/enabled counts.
- [ ] Add test: metrics update after multiple runs.
- [ ] Add test: upcoming runs are accurate.
- [ ] Add test: 3 consecutive failures marks agent unhealthy.

## Phase 9: Hardening + Delivery

- [ ] Add centralized error types and error-to-status mapping.
- [ ] Add graceful shutdown (stop scheduler, finish in-flight jobs, close DB).
- [ ] Add idempotency guard to avoid duplicate run in same schedule window.
- [ ] Add basic rate-limit/concurrency controls for LLM calls.
- [ ] Add README usage docs for setup, run, and management commands.
- [ ] Add architecture diagram and component responsibilities.
- [ ] Add integration test scenario covering end-to-end scheduled run.
- [ ] Add CI workflow for lint, typecheck, and tests.

## Phase 10: Stretch Goals (Going Further)

- [ ] Add tool/skill execution support (MCP integration).
- [ ] Add agent chaining (output of one agent as input to another).
- [ ] Add external data fetch modules (RSS/API/web sources).
- [ ] Add LLM quota/rate-limit-aware scheduler staggering.
- [ ] Build optional web dashboard for agent status and timelines.

## Suggested Execution Order

- [x] Complete Phases 0-1 first.
- [x] Complete Phase 2 before fully implementing Phases 3-8.
- [x] Deliver Phases 3-4 in order, validating each with tests.
- [x] Deliver Phases 5-6 in order, validating each with tests.
- [ ] Deliver Phases 7-8 in order, validating each with tests.
- [ ] Reserve Phases 9-10 for stabilization and enhancements.
