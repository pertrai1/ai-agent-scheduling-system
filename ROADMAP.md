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

- [ ] Define `Agent` schema (name, taskDescription, optional systemPrompt).
- [ ] Define `ExecutionResult` schema (agentName, ranAt, status, response, error).
- [ ] Create Gemini client wrapper with a single `generateText` method.
- [ ] Implement prompt builder combining `systemPrompt` and `taskDescription`.
- [ ] Implement `runAgent(agent)` returning structured success/failure result.
- [ ] Catch and normalize LLM errors into a consistent error object/string.
- [ ] Add manual run command/function for a single agent.
- [ ] Add test: simple summarization agent returns success structure.
- [ ] Add test: system prompt changes response style.
- [ ] Add test: impossible task returns graceful result without crashing.

## Phase 2: Persistence Foundation (Needed Before Scheduling Scale)

- [ ] Create SQLite connection module.
- [ ] Add migration runner setup.
- [ ] Create `agents` table migration.
- [ ] Create `executions` table migration.
- [ ] Add repository function: insert agent.
- [ ] Add repository function: fetch agent by id/name.
- [ ] Add repository function: list agents.
- [ ] Add repository function: update agent fields.
- [ ] Add repository function: delete agent.
- [ ] Add repository function: insert execution record.
- [ ] Add repository function: list execution history by agent.
- [ ] Add startup check that migrations run successfully.

## Phase 3: Cron Scheduling Engine (Step 2)

- [ ] Extend agent schema with `cronExpression` and `enabled` flag.
- [ ] Add cron expression validator utility.
- [ ] Implement scheduler tick loop (minute-level check).
- [ ] Implement `isAgentDueNow(agent, now)` function.
- [ ] Implement concurrent execution for multiple due agents.
- [ ] Ensure one agent failure does not block other agent runs.
- [ ] Add last-run tracking update after each execution.
- [ ] Add startup behavior to load enabled agents into scheduler.
- [ ] Add test: `* * * * *` runs once per minute.
- [ ] Add test: two agents due same minute both execute.
- [ ] Add test: disabled agent does not execute.
- [ ] Add test: re-enabled agent resumes execution.
- [ ] Add test: `*/5 * * * *` timing logic is correct.

## Phase 4: Natural Language Scheduling (Step 3)

- [ ] Create parser interface: natural language input -> cron output.
- [ ] Implement NL parsing strategy (LLM or library-backed).
- [ ] Add strict post-parse cron validation.
- [ ] Add human-readable schedule description generator.
- [ ] Add parse response shape: `cron`, `description`, `confidence/notes`.
- [ ] Return explicit parse error for ambiguous or unparseable input.
- [ ] Add confirmation flow to show interpreted cron before save.
- [ ] Add test: "every day at 7am" -> `0 7 * * *`.
- [ ] Add test: "every weekday at 9am" -> `0 9 * * 1-5`.
- [ ] Add test: "every Monday at 8am" -> `0 8 * * 1`.
- [ ] Add test: "every 3 hours" -> `0 */3 * * *`.
- [ ] Add test: "twice a day" resolves to valid expected schedule.
- [ ] Add test: ambiguous text returns clear actionable error.

## Phase 5: Resilience (Timeout + Retry) (Step 4)

- [ ] Extend agent config with `timeoutMs`, `maxRetries`, `backoffBaseMs`.
- [ ] Add default settings (e.g., timeout 60s, retries 3).
- [ ] Wrap LLM execution with timeout controller.
- [ ] Create retry runner utility with exponential backoff + jitter.
- [ ] Retry only transient failures/timeouts (or configurable policy).
- [ ] Record attempt count and final outcome in execution record.
- [ ] Ensure exhausted failures are marked permanent failure.
- [ ] Ensure failed run does not block next scheduled run.
- [ ] Add test: timeout triggers retry sequence.
- [ ] Add test: failing call retries exact configured count.
- [ ] Add test: backoff delays increase across attempts.
- [ ] Add test: success on first attempt performs zero retries.
- [ ] Add test: next schedule still runs after permanent failure.

## Phase 6: Email Notifications (Step 5)

- [ ] Add email config schema (provider/SMTP host, port, auth, sender).
- [ ] Add email client abstraction (`sendSuccess`, `sendFailure`).
- [ ] Add agent field `emailRecipient`.
- [ ] Implement success email template (subject, timestamp, formatted output).
- [ ] Implement failure email template (error details + metadata).
- [ ] Trigger email send after agent execution completes.
- [ ] Decouple email retry from agent execution retry.
- [ ] Add email-delivery retry policy and logging.
- [ ] Add test: success execution sends properly formatted email.
- [ ] Add test: failed execution sends failure email.
- [ ] Add test: broken email config does not fail agent execution.
- [ ] Add test: email delivery retries and logs failures.

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

- [ ] Complete Phases 0-1 first.
- [ ] Complete Phase 2 before fully implementing Phases 3-8.
- [ ] Deliver Phases 3-8 in order, validating each with tests.
- [ ] Reserve Phases 9-10 for stabilization and enhancements.
