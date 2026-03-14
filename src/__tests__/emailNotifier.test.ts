import { describe, it, expect, vi, beforeEach } from "vitest";
import nodemailer from "nodemailer";
import {
  sendSuccess,
  sendFailure,
  formatSuccessEmail,
  formatFailureEmail,
  createTransport,
} from "../emailNotifier";
import type { Agent } from "../agent";
import type { ExecutionResult } from "../agent";
import type { Config } from "../config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-1.5-flash",
    SMTP_HOST: "localhost",
    SMTP_PORT: 1025,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    EMAIL_FROM: "noreply@example.com",
    PORT: 3000,
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    ...overrides,
  };
}

const baseAgent: Agent = {
  name: "Test Agent",
  taskDescription: "Run a test task",
  emailRecipient: "user@example.com",
};

const successResult: ExecutionResult = {
  agentName: "Test Agent",
  ranAt: new Date("2026-01-01T10:00:00.000Z"),
  status: "success",
  response: "All done!",
  attempts: 1,
};

const failureResult: ExecutionResult = {
  agentName: "Test Agent",
  ranAt: new Date("2026-01-01T10:00:00.000Z"),
  status: "failure",
  error: "Something went wrong",
  attempts: 3,
};

// ---------------------------------------------------------------------------
// formatSuccessEmail
// ---------------------------------------------------------------------------

describe("formatSuccessEmail", () => {
  it("includes agent name and timestamp in the subject", () => {
    const { subject } = formatSuccessEmail(baseAgent, successResult);
    expect(subject).toContain("Test Agent");
    expect(subject).toContain("2026-01-01T10:00:00.000Z");
    expect(subject).toContain("succeeded");
  });

  it("includes agent name, status, ranAt, attempts, and response in the body", () => {
    const { text } = formatSuccessEmail(baseAgent, successResult);
    expect(text).toContain("Test Agent");
    expect(text).toContain("Success");
    expect(text).toContain("2026-01-01T10:00:00.000Z");
    expect(text).toContain("1");
    expect(text).toContain("All done!");
  });

  it("falls back to (no response) when response is absent", () => {
    const result: ExecutionResult = { ...successResult, response: undefined };
    const { text } = formatSuccessEmail(baseAgent, result);
    expect(text).toContain("(no response)");
  });
});

// ---------------------------------------------------------------------------
// formatFailureEmail
// ---------------------------------------------------------------------------

describe("formatFailureEmail", () => {
  it("includes agent name and timestamp in the subject", () => {
    const { subject } = formatFailureEmail(baseAgent, failureResult);
    expect(subject).toContain("Test Agent");
    expect(subject).toContain("2026-01-01T10:00:00.000Z");
    expect(subject).toContain("FAILED");
  });

  it("includes agent name, status, ranAt, attempts, and error in the body", () => {
    const { text } = formatFailureEmail(baseAgent, failureResult);
    expect(text).toContain("Test Agent");
    expect(text).toContain("Failure");
    expect(text).toContain("2026-01-01T10:00:00.000Z");
    expect(text).toContain("3");
    expect(text).toContain("Something went wrong");
  });

  it("falls back to (unknown error) when error is absent", () => {
    const result: ExecutionResult = { ...failureResult, error: undefined };
    const { text } = formatFailureEmail(baseAgent, result);
    expect(text).toContain("(unknown error)");
  });
});

// ---------------------------------------------------------------------------
// sendSuccess
// ---------------------------------------------------------------------------

describe("sendSuccess", () => {
  let sendMailMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMailMock = vi.fn().mockResolvedValue({ messageId: "ok" });
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as nodemailer.Transporter);
  });

  it("sends an email with correct subject and body on success", async () => {
    const config = makeConfig();
    await sendSuccess(config, baseAgent, successResult, { maxRetries: 0 });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0] as nodemailer.SendMailOptions;
    expect(call.to).toBe("user@example.com");
    expect(call.from).toBe("noreply@example.com");
    expect(String(call.subject)).toContain("succeeded");
    expect(String(call.text)).toContain("All done!");
  });

  it("does not send an email when emailRecipient is absent", async () => {
    const agentNoEmail: Agent = { ...baseAgent, emailRecipient: undefined };
    const config = makeConfig();
    await sendSuccess(config, agentNoEmail, successResult);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendFailure
// ---------------------------------------------------------------------------

describe("sendFailure", () => {
  let sendMailMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMailMock = vi.fn().mockResolvedValue({ messageId: "ok" });
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as nodemailer.Transporter);
  });

  it("sends a failure email with error details", async () => {
    const config = makeConfig();
    await sendFailure(config, baseAgent, failureResult, { maxRetries: 0 });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0] as nodemailer.SendMailOptions;
    expect(call.to).toBe("user@example.com");
    expect(String(call.subject)).toContain("FAILED");
    expect(String(call.text)).toContain("Something went wrong");
  });

  it("does not send an email when emailRecipient is absent", async () => {
    const agentNoEmail: Agent = { ...baseAgent, emailRecipient: undefined };
    const config = makeConfig();
    await sendFailure(config, agentNoEmail, failureResult);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Broken email config does not fail agent execution
// ---------------------------------------------------------------------------

describe("email delivery failure isolation", () => {
  it("sendSuccess does not throw when SMTP delivery fails after retries", async () => {
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error("SMTP connection refused")),
    } as unknown as nodemailer.Transporter);

    const config = makeConfig();
    // Should resolve (not throw) even though delivery fails
    await expect(
      sendSuccess(config, baseAgent, successResult, { maxRetries: 0 })
    ).resolves.toBeUndefined();
  });

  it("sendFailure does not throw when SMTP delivery fails after retries", async () => {
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error("SMTP connection refused")),
    } as unknown as nodemailer.Transporter);

    const config = makeConfig();
    await expect(
      sendFailure(config, baseAgent, failureResult, { maxRetries: 0 })
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Email delivery retry
// ---------------------------------------------------------------------------

describe("email delivery retry", () => {
  it("retries the configured number of times before giving up", async () => {
    const sendMailMock = vi
      .fn()
      .mockRejectedValue(new Error("transient SMTP error"));

    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as nodemailer.Transporter);

    const config = makeConfig();
    await sendSuccess(config, baseAgent, successResult, {
      maxRetries: 2,
      backoffBaseMs: 1,
    });

    // 1 initial attempt + 2 retries = 3 total calls
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it("succeeds on a later retry attempt", async () => {
    const sendMailMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ messageId: "ok" });

    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as nodemailer.Transporter);

    const config = makeConfig();
    await sendSuccess(config, baseAgent, successResult, {
      maxRetries: 2,
      backoffBaseMs: 1,
    });

    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// createTransport uses SMTP config correctly
// ---------------------------------------------------------------------------

describe("createTransport", () => {
  it("builds a transporter with host and port from config", () => {
    const createTransportSpy = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({} as nodemailer.Transporter);

    const config = makeConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: 587 });
    createTransport(config);

    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587 })
    );
  });

  it("includes auth when SMTP_USER and SMTP_PASS are set", () => {
    const createTransportSpy = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({} as nodemailer.Transporter);

    const config = makeConfig({ SMTP_USER: "user", SMTP_PASS: "pass" });
    createTransport(config);

    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: "user", pass: "pass" },
      })
    );
  });

  it("omits auth when SMTP_USER is not set", () => {
    const createTransportSpy = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({} as nodemailer.Transporter);

    const config = makeConfig({ SMTP_USER: undefined, SMTP_PASS: undefined });
    createTransport(config);

    const callArg = createTransportSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg["auth"]).toBeUndefined();
  });
});
