import nodemailer from "nodemailer";
import type { Config } from "./config";
import type { Agent } from "./agent";
import type { ExecutionResult } from "./agent";

// ---------------------------------------------------------------------------
// Retry options (independent from agent execution retry)
// ---------------------------------------------------------------------------

export interface EmailRetryOptions {
  maxRetries?: number;
  backoffBaseMs?: number;
}

const DEFAULT_EMAIL_RETRY: Required<EmailRetryOptions> = {
  maxRetries: 3,
  backoffBaseMs: 1_000,
};

// ---------------------------------------------------------------------------
// Transport factory
// ---------------------------------------------------------------------------

export function createTransport(config: Config): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    auth:
      config.SMTP_USER && config.SMTP_PASS
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Email formatters
// ---------------------------------------------------------------------------

export function formatSuccessEmail(
  agent: Agent,
  result: ExecutionResult
): { subject: string; text: string } {
  const subject = `[AI Agent] "${agent.name}" succeeded – ${result.ranAt.toISOString()}`;
  const text = [
    `Agent:    ${agent.name}`,
    `Status:   Success`,
    `Ran at:   ${result.ranAt.toISOString()}`,
    `Attempts: ${result.attempts ?? 1}`,
    ``,
    `Response:`,
    result.response ?? "(no response)",
  ].join("\n");
  return { subject, text };
}

export function formatFailureEmail(
  agent: Agent,
  result: ExecutionResult
): { subject: string; text: string } {
  const subject = `[AI Agent] "${agent.name}" FAILED – ${result.ranAt.toISOString()}`;
  const text = [
    `Agent:    ${agent.name}`,
    `Status:   Failure`,
    `Ran at:   ${result.ranAt.toISOString()}`,
    `Attempts: ${result.attempts ?? 1}`,
    ``,
    `Error:`,
    result.error ?? "(unknown error)",
  ].join("\n");
  return { subject, text };
}

// ---------------------------------------------------------------------------
// Internal send with independent retry
// ---------------------------------------------------------------------------

async function sendWithRetry(
  transport: nodemailer.Transporter,
  from: string,
  to: string,
  subject: string,
  text: string,
  opts: Required<EmailRetryOptions>
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      await transport.sendMail({ from, to, subject, text });
      return;
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < opts.maxRetries) {
        const delay = opts.backoffBaseMs * Math.pow(2, attempt);
        console.error(
          `[emailNotifier] Delivery attempt ${attempt + 1} failed: ${msg}. Retrying in ${delay}ms…`
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(
          `[emailNotifier] All ${opts.maxRetries + 1} delivery attempt(s) failed: ${msg}`
        );
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a success notification email for a completed agent run.
 * No-ops silently when the agent has no `emailRecipient`.
 * Email delivery errors are independent of agent execution and do not throw.
 */
export async function sendSuccess(
  config: Config,
  agent: Agent,
  result: ExecutionResult,
  options: EmailRetryOptions = {}
): Promise<void> {
  if (!agent.emailRecipient) return;

  const opts: Required<EmailRetryOptions> = { ...DEFAULT_EMAIL_RETRY, ...options };
  const { subject, text } = formatSuccessEmail(agent, result);
  const transport = createTransport(config);

  try {
    await sendWithRetry(transport, config.EMAIL_FROM, agent.emailRecipient, subject, text, opts);
    console.log(
      `[emailNotifier] Success email sent to ${agent.emailRecipient} for agent "${agent.name}".`
    );
  } catch (err: unknown) {
    console.error(
      `[emailNotifier] Failed to deliver success email for agent "${agent.name}":`,
      err
    );
  }
}

/**
 * Send a failure notification email for a failed agent run.
 * No-ops silently when the agent has no `emailRecipient`.
 * Email delivery errors are independent of agent execution and do not throw.
 */
export async function sendFailure(
  config: Config,
  agent: Agent,
  result: ExecutionResult,
  options: EmailRetryOptions = {}
): Promise<void> {
  if (!agent.emailRecipient) return;

  const opts: Required<EmailRetryOptions> = { ...DEFAULT_EMAIL_RETRY, ...options };
  const { subject, text } = formatFailureEmail(agent, result);
  const transport = createTransport(config);

  try {
    await sendWithRetry(transport, config.EMAIL_FROM, agent.emailRecipient, subject, text, opts);
    console.log(
      `[emailNotifier] Failure email sent to ${agent.emailRecipient} for agent "${agent.name}".`
    );
  } catch (err: unknown) {
    console.error(
      `[emailNotifier] Failed to deliver failure email for agent "${agent.name}":`,
      err
    );
  }
}
