# AI Agent Schedule System Challenge

This challenge is to build your own AI agent scheduling system - a system that runs AI-powered tasks automatically on a cron schedule and delivers the results to you.

You’ll build a system that lets you define named AI agents, each with a task description and a cron schedule, that run automatically and deliver their results by email. Along the way you’ll work with LLM integration, cron-based job scheduling, natural language parsing, retry logic, and email delivery.

The challenge starts with a basic AI agent that can execute a single task, then progressively adds scheduling, resilience, notifications, and management capabilities. Here are some use cases the full solution could handle:

- **Morning Briefing** - An agent runs every day at 7am, pulls your email, calendar, and relevant news, and drops a structured brief into your inbox.
- **Weekly Dependency Watch** - Every Monday at 8am, an agent checks your project’s key dependencies for new releases, security advisories, and deprecation notices, and delivers a structured summary.
- **Daily Outage & Incident Digest** - Every few hours, an agent checks the status pages of services your stack depends on (AWS, GitHub, npm, your CI provider) and flags any ongoing or recent incidents that could affect your work.
- **Weekly Tech Radar** - Every Monday, an agent scans Hacker News, tech blogs, and release notes for developments in your chosen technology areas and delivers a curated summary.
PR Review Reminder - Twice a day, an agent checks your team’s open pull requests and sends you a summary of what’s awaiting review, what’s gone stale, and what’s been merged.

## Step Zero

In this introductory step you’re going to set your environment up ready to begin developing and testing your solution.

You’ll need to make a few decisions:

- **Choose your LLM provider.** You’ll need access to a language model for your agents to use when processing tasks. LLM provider will be: **Google Gemini**
- **Choose your programming language.** Pick something you’re comfortable with for both HTTP requests and background job processing. You’ll be building a long-running service that needs to make API calls, run tasks on a schedule, and send emails. Programming language will be: **TypeScript/NodeJS/Zod**
- **Choose your persistence layer.** You’ll need somewhere to store agent definitions, schedules, and execution history. A lightweight database like SQLite works well to start with, or Redis if you’d prefer something in-memory. Persistence layer will be: **SQLite**

## Step 1

In this step your goal is to build a basic AI agent that can execute a single task.

An agent at this stage is straightforward: it takes a task description (a natural language prompt), sends it to your LLM, and returns the result. Think of it as a thin wrapper around an LLM call that adds structure.

Define an agent with a name, a task description, and optionally a system prompt that shapes how the agent behaves. For example, an agent called “Hacker News Summariser” might have the task “Summarise the top five technology news stories today’s hacker news posts which are {posts}”, where you substitute in the posts from Hacker News and a system prompt instructing it to be concise and use bullet points.

The agent should return a structured result containing the agent’s name, the time the task ran, whether it succeeded or failed, and the LLM’s response.

Testing: Create a few agents with different task descriptions and run them manually:

- A simple summarisation agent - give it a prompt like “Summarise the key benefits of test-driven development” and verify you get a coherent response.
- An agent with a specific system prompt - verify the response style matches the instructions in the system prompt.
- An agent with a deliberately impossible task - verify it completes without crashing and returns something sensible.

Check that the structured result includes the agent name, timestamp, status, and response content.

## Step 2

In this step your goal is to add cron-based scheduling so agents run automatically at defined intervals.

It should be possible to configure the invocation of each agent based on a cron expression that defines when it runs. Support the full five-field cron format: minute, hour, day of month, month, and day of week. This gives you the flexibility to express schedules like “every hour” (0 * * * *), “weekdays at 9am” (0 9 * * 1-5), or “first Monday of every month at 8am” (0 8 1-7 * 1).

Your scheduler should evaluate all registered agents, determine which ones are due to run, execute them, and then wait for the next tick. When multiple agents are due at the same time, they should all run - don’t let one agent’s execution block another.

Agents should also have an enabled/disabled flag so you can pause an agent’s schedule without deleting it.

Testing:

- Create an agent with a schedule of * * * * (every minute) and verify it fires once per minute.
- Create two agents scheduled for the same time and verify both run.
- Disable an agent and verify it stops running on schedule. Re-enable it and verify it resumes.
- Set up an agent with a more complex expression like /5 * * * * (every five minutes) and verify the timing is correct.
- Check that the scheduler continues running reliably over a period of at least an hour without drifting or missing executions.

## Step 3

In this step your goal is to add natural language schedule parsing so users can describe when they want an agent to run in plain English instead of writing cron expressions.

Expressions like “every weekday at 9am”, “every Monday at 8am”, “twice a day”, “every 3 hours”, or “the first of every month” should be parsed into the corresponding cron expression. You can use your LLM to handle this translation, or a dedicated natural language parsing library - either approach works.

When a user provides a natural language schedule, show them the interpreted cron expression and a human-readable description of what it means (e.g. “Runs at 09:00 on Monday through Friday”) so they can confirm it’s correct before saving.

If the input is ambiguous or can’t be parsed, the system should say so clearly and ask the user to rephrase rather than guessing incorrectly.

Testing:

- Try a range of natural language inputs and verify each produces the correct cron expression:
“every day at 7am” should produce 0 7 * * *
“every weekday at 9am” should produce 0 9 * * 1-5
“every Monday at 8am” should produce 0 8 * * 1
“every 3 hours” should produce 0 */3 * * *
“twice a day” should produce something reasonable like 0 9,18 * * * (the exact times may vary)
- Try an ambiguous input like “sometimes in the morning” and verify you get a clear error or clarification request rather than a bad cron expression.
- Verify the human-readable confirmation message accurately describes the interpreted schedule.

## Step 4

In this step your goal is to add timeout handling and retry logic so your agents are resilient to transient failures.

LLM API calls can be slow, rate-limited, or simply fail. Your agents need to handle this gracefully. Each agent should have a configurable execution timeout - if the task hasn’t completed within that time, it should be terminated cleanly. A sensible default is 60 seconds, but agents that do heavier processing might need longer.

When an execution fails (whether from a timeout, an API error, or any other exception), the agent should retry automatically. Each agent should have a configurable maximum number of retries and a backoff strategy. Exponential backoff with jitter is a solid default - it avoids hammering a struggling API with rapid retries.

After all retries are exhausted, the agent should record a permanent failure for that execution with the error details. Failed executions should never block future scheduled runs of the same agent.

Testing:

- Set an agent’s timeout to something very short (e.g. 2 seconds) with a task that takes longer than that. Verify the execution times out and a retry is attempted.
- Configure an agent with 3 maximum retries and simulate a failing LLM call (you could temporarily use an invalid API key or point to a non-existent endpoint). Verify it retries exactly 3 times before recording a permanent failure.
- Check that the backoff delay increases between retries rather than retrying immediately each time.
- After a failed execution with all retries exhausted, verify the agent still runs on its next scheduled time as normal.
- Run an agent that succeeds on the first attempt and verify no retries are triggered.

## Step 5

In this step your goal is to add email delivery so agent results are sent to you automatically.

When an agent completes its scheduled run, it should send the results to a configured email address. The email should include the agent’s name in the subject line, the timestamp of the execution, and the full response from the LLM formatted for readability.

Use an email sending service such as Resend or SendGrid or use SMTP directly to deliver the messages. For development and testing, a local SMTP tool like Mailpit or MailHog lets you capture emails without actually sending them.

If the email delivery fails, it should be retried independently of the agent execution itself - the agent’s task already succeeded, so you don’t want to re-run the whole thing just because the notification didn’t go through. Log delivery failures for visibility.

For failed agent executions (after all retries are exhausted), send a failure notification email instead, including the error details so you know something went wrong without having to check logs.

Testing:

- Run an agent and verify an email arrives with the correct subject line, agent name, timestamp, and response content.
- Verify the email content is well-formatted and readable, not a raw text dump.
- Check that a failed agent execution sends a failure notification email with error details.
- Temporarily break your email configuration and verify the agent execution still completes successfully - only the delivery should fail, not the whole run.
- Verify email delivery failures are logged and retried.

## Step 6

In this step your goal is to build a management interface for creating, editing, listing, and deleting agents.

Up to now you’ve probably been configuring agents directly in code or a configuration file. In this step, add an API (or CLI, if you prefer) that lets you manage agents without touching the code.

You should be able to create a new agent by providing a name, task description, system prompt, schedule (cron expression or natural language), email recipient, timeout, and retry settings. You should also be able to list all registered agents with their current status (enabled, disabled, last run time, last run result), edit any agent’s configuration, and delete agents you no longer need.

Each agent’s configuration and execution history should be persisted so everything survives a restart of the service. The execution history for each agent should include the timestamp, status (success or failure), duration, and a summary of the result or error.

Testing:

- Create a new agent through the management interface and verify it starts running on its defined schedule.
- List all agents and check the output shows correct status information.
- Edit an agent’s schedule and verify the new schedule takes effect without needing to restart the service.
- Delete an agent and verify it stops running and is removed from the listing.
- Restart the service and verify all agent configurations and execution history are preserved.
- View the execution history for an agent and verify it includes timestamps, statuses, and durations for recent runs.

## Step 7

In this step your goal is to add execution logging and a monitoring endpoint so you can observe your system’s health at a glance.

Build a status endpoint (or command) that reports the overall system health: how many agents are registered, how many are enabled, upcoming scheduled runs, and aggregate statistics like total executions, success rate, and average execution time.

Each execution should be logged with enough detail to diagnose problems: the agent name, start time, duration, whether it succeeded or failed, the number of retries attempted, and a truncated version of the response or error. Keep a rolling window of execution history - the last 100 runs per agent is a reasonable default.

If any agent has failed its last three consecutive runs, flag it in the status output as unhealthy so you know to investigate.

Testing:

- Query the status endpoint and verify it reports the correct number of registered and enabled agents.
- Run several agents and check the aggregate statistics update correctly (total executions, success rate, average duration).
- Verify upcoming scheduled runs are listed with the correct next-run times.
- Simulate three consecutive failures for an agent and verify it appears as unhealthy in the status output.
- Check the execution log for an agent and verify it contains the expected detail for each run.

## Going Further

You’ve built a scheduled AI agent system with cron scheduling, retry logic, and email delivery. Here are some ways to push it further:

- Skill or MCP support: Add the ability for agents to call skills, use tools and MCP.
- Web Dashboard: Build a web-based dashboard that visualises agent status, execution history, and upcoming schedules. A timeline view showing when each agent last ran and when it will run next is particularly useful.
- Agent Chaining: Let one agent’s output become another agent’s input. For example, a data-gathering agent runs first, and its results are passed to a summarisation agent that formats and delivers the final report.
- External Data Sources: Give your agents the ability to fetch live data as part of their tasks - pulling from RSS feeds, APIs, or web searches before asking the LLM to process the results. This turns your agents from simple prompt runners into genuine automation tools.
- Rate Limit Management: Add awareness of your LLM provider’s rate limits. If multiple agents are scheduled close together, stagger their execution to stay within your API quota rather than having them all fail from rate limiting. 