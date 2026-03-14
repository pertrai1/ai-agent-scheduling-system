/**
 * Example 08 – Management REST API
 *
 * Demonstrates how to interact with the built-in REST API programmatically:
 *
 *   POST   /agents             – create an agent
 *   GET    /agents             – list all agents
 *   GET    /agents/:id         – get a specific agent
 *   PATCH  /agents/:id         – update an agent (enable/change schedule)
 *   GET    /agents/:id/executions – view execution history
 *   DELETE /agents/:id         – delete an agent
 *   GET    /status             – system health and statistics
 *
 * The script starts an in-process ApiServer bound to an ephemeral port,
 * runs through the full CRUD lifecycle, then shuts the server down.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/08-rest-api.ts
 */

import http from "http";
import { loadConfig } from "../src/config";
import { GeminiClient } from "../src/geminiClient";
import { openDatabase } from "../src/database";
import { runMigrations } from "../src/migrations";
import { ApiServer } from "../src/apiServer";

// ---------------------------------------------------------------------------
// Minimal HTTP helper
// ---------------------------------------------------------------------------

function request(
  method: string,
  url: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const parsed = new URL(url);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data: unknown = JSON.parse(
              Buffer.concat(chunks).toString("utf8")
            );
            resolve({ status: res.statusCode ?? 0, data });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: null });
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function print(label: string, res: { status: number; data: unknown }): void {
  console.log(`\n${label}  [HTTP ${res.status}]`);
  console.log(JSON.stringify(res.data, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

void (async () => {
  const config = loadConfig();

  const client = new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });

  const db = openDatabase(":memory:");
  await runMigrations(db);

  const server = new ApiServer(db, client);
  const port = await server.start(0); // 0 = OS-assigned ephemeral port
  const base = `http://localhost:${port}`;

  console.log(`API server started on ${base}`);

  // 1. Create an agent
  const created = await request("POST", `${base}/agents`, {
    name: "Daily Digest",
    taskDescription: "Summarise the most important events in software engineering today.",
    systemPrompt: "Be concise. Use bullet points.",
    scheduleInput: "0 8 * * *", // every day at 08:00
    enabled: false,
    maxRetries: 2,
    timeoutMs: 60_000,
    emailRecipient: "engineer@example.com",
  });
  print("POST /agents", created);

  const agentId = (created.data as { id: number }).id;

  // 2. List all agents
  print("GET /agents", await request("GET", `${base}/agents`));

  // 3. Get the specific agent
  print(`GET /agents/${agentId}`, await request("GET", `${base}/agents/${agentId}`));

  // 4. Enable the agent and change the schedule to every 5 minutes
  print(
    `PATCH /agents/${agentId}`,
    await request("PATCH", `${base}/agents/${agentId}`, {
      enabled: true,
      scheduleInput: "*/5 * * * *",
    })
  );

  // 5. View execution history (empty at this point)
  print(
    `GET /agents/${agentId}/executions`,
    await request("GET", `${base}/agents/${agentId}/executions`)
  );

  // 6. System status
  print("GET /status", await request("GET", `${base}/status`));

  // 7. Delete the agent
  print(
    `DELETE /agents/${agentId}`,
    await request("DELETE", `${base}/agents/${agentId}`)
  );

  // 8. Confirm the agent is gone
  print("GET /agents (after delete)", await request("GET", `${base}/agents`));

  // Shutdown
  await server.stop();
  console.log("\nServer stopped. Done.");
  process.exit(0);
})();
