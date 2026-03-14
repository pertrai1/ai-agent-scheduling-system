import { describe, it, expect } from "vitest";
import { loadConfig } from "../config";

describe("config", () => {
  it("loads valid configuration with required env vars", () => {
    const cfg = loadConfig({ GEMINI_API_KEY: "test-api-key" });

    expect(cfg.GEMINI_API_KEY).toBe("test-api-key");
    expect(cfg.GEMINI_MODEL).toBe("gemini-1.5-flash");
    expect(cfg.SMTP_HOST).toBe("localhost");
    expect(cfg.SMTP_PORT).toBe(1025);
    expect(cfg.EMAIL_FROM).toBe("noreply@example.com");
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg.LOG_LEVEL).toBe("info");
  });

  it("throws when GEMINI_API_KEY is missing", () => {
    expect(() => loadConfig({})).toThrow("Configuration validation failed");
    expect(() => loadConfig({})).toThrow("GEMINI_API_KEY");
  });

  it("respects custom env var overrides", () => {
    const cfg = loadConfig({
      GEMINI_API_KEY: "my-key",
      GEMINI_MODEL: "gemini-pro",
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      SMTP_PORT: "587",
    });

    expect(cfg.GEMINI_MODEL).toBe("gemini-pro");
    expect(cfg.NODE_ENV).toBe("production");
    expect(cfg.LOG_LEVEL).toBe("warn");
    expect(cfg.SMTP_PORT).toBe(587);
  });
});
