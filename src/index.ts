import { loadConfig } from "./config";

const config = loadConfig();

function logHealth(): void {
  console.log("[AI Agent Scheduling System] Service starting...");
  console.log(`  environment : ${config.NODE_ENV}`);
  console.log(`  log level   : ${config.LOG_LEVEL}`);
  console.log(`  gemini model: ${config.GEMINI_MODEL}`);
  console.log(`  smtp host   : ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  console.log(`  email from  : ${config.EMAIL_FROM}`);
  console.log("[AI Agent Scheduling System] Service is healthy. Ready.");
}

logHealth();
