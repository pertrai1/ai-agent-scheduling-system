import http from "http";
import type sqlite3 from "sqlite3";
import { z } from "zod";
import type { GeminiClient } from "./geminiClient";
import type { AgentUpdates } from "./agentRepository";
import {
  insertAgent,
  fetchAgentById,
  listAgents,
  updateAgent,
  deleteAgent,
  listExecutionsByAgentId,
} from "./agentRepository";
import { validateCronExpression } from "./cronValidator";
import { parseNaturalLanguageSchedule, isParsedSchedule } from "./nlScheduleParser";

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

const CreateAgentBodySchema = z.object({
  name: z.string().min(1, "name is required"),
  taskDescription: z.string().min(1, "taskDescription is required"),
  systemPrompt: z.string().optional(),
  scheduleInput: z.string().min(1).optional(),
  enabled: z.boolean().optional().default(false),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  backoffBaseMs: z.number().int().positive().optional(),
  emailRecipient: z.string().email("emailRecipient must be a valid email").optional(),
});

const UpdateAgentBodySchema = z.object({
  name: z.string().min(1).optional(),
  taskDescription: z.string().min(1).optional(),
  systemPrompt: z.string().optional(),
  scheduleInput: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  backoffBaseMs: z.number().int().positive().optional(),
  emailRecipient: z.string().email().optional(),
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

// ---------------------------------------------------------------------------
// Schedule resolution — cron or natural language
// ---------------------------------------------------------------------------

async function resolveScheduleInput(
  scheduleInput: string,
  client?: GeminiClient
): Promise<{ cronExpression: string } | { error: string }> {
  if (validateCronExpression(scheduleInput)) {
    return { cronExpression: scheduleInput };
  }

  if (!client) {
    return {
      error: `"${scheduleInput}" is not a valid cron expression. Provide an LLM client to support natural language scheduling.`,
    };
  }

  const result = await parseNaturalLanguageSchedule(scheduleInput, client);
  if (isParsedSchedule(result)) {
    return { cronExpression: result.cron };
  }
  return { error: result.error };
}

// ---------------------------------------------------------------------------
// ApiServer
// ---------------------------------------------------------------------------

export class ApiServer {
  private db: sqlite3.Database;
  private client: GeminiClient | undefined;
  private server: http.Server;

  constructor(db: sqlite3.Database, client?: GeminiClient) {
    this.db = db;
    this.client = client;
    this.server = http.createServer((req, res) => {
      void this.dispatch(req, res);
    });
  }

  /**
   * Start the HTTP server.  When port is 0 the OS will pick a free port.
   * Returns the actual port the server bound to.
   */
  start(port = 3000): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, () => {
        const addr = this.server.address();
        const boundPort = typeof addr === "object" && addr !== null ? addr.port : port;
        console.log(`[apiServer] Listening on port ${boundPort}`);
        resolve(boundPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const method = (req.method ?? "GET").toUpperCase();
      const path = (req.url ?? "/").split("?")[0];

      const agentsRoot = /^\/agents$/.exec(path);
      const agentById = /^\/agents\/(\d+)$/.exec(path);
      const executionsByAgent = /^\/agents\/(\d+)\/executions$/.exec(path);

      if (agentsRoot) {
        if (method === "GET") return await this.handleListAgents(res);
        if (method === "POST") return await this.handleCreateAgent(req, res);
        return sendJson(res, 405, { error: "Method not allowed" });
      }

      if (agentById) {
        const id = parseInt(agentById[1], 10);
        if (method === "GET") return await this.handleGetAgent(res, id);
        if (method === "PATCH") return await this.handleUpdateAgent(req, res, id);
        if (method === "DELETE") return await this.handleDeleteAgent(res, id);
        return sendJson(res, 405, { error: "Method not allowed" });
      }

      if (executionsByAgent) {
        const id = parseInt(executionsByAgent[1], 10);
        if (method === "GET") return await this.handleListExecutions(res, id);
        return sendJson(res, 405, { error: "Method not allowed" });
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[apiServer] Unhandled error:", err);
      sendJson(res, 500, { error: message });
    }
  }

  // ---------------------------------------------------------------------------
  // Route handlers
  // ---------------------------------------------------------------------------

  private async handleListAgents(res: http.ServerResponse): Promise<void> {
    const agents = await listAgents(this.db);
    sendJson(res, 200, agents);
  }

  private async handleCreateAgent(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "Failed to read request body" });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const parsed = CreateAgentBodySchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const data = parsed.data;
    let cronExpression: string | undefined;

    if (data.scheduleInput) {
      const resolved = await resolveScheduleInput(data.scheduleInput, this.client);
      if ("error" in resolved) {
        sendJson(res, 400, { error: resolved.error });
        return;
      }
      cronExpression = resolved.cronExpression;
    }

    try {
      const agent = await insertAgent(this.db, {
        name: data.name,
        taskDescription: data.taskDescription,
        systemPrompt: data.systemPrompt,
        cronExpression,
        enabled: data.enabled,
        timeoutMs: data.timeoutMs,
        maxRetries: data.maxRetries,
        backoffBaseMs: data.backoffBaseMs,
        emailRecipient: data.emailRecipient,
      });
      sendJson(res, 201, agent);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      if (code === "SQLITE_CONSTRAINT" || message.includes("UNIQUE constraint failed")) {
        sendJson(res, 409, { error: `An agent named "${data.name}" already exists` });
      } else {
        throw err;
      }
    }
  }

  private async handleGetAgent(res: http.ServerResponse, id: number): Promise<void> {
    const agent = await fetchAgentById(this.db, id);
    if (!agent) {
      sendJson(res, 404, { error: `Agent with id ${id} not found` });
      return;
    }
    sendJson(res, 200, agent);
  }

  private async handleUpdateAgent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: number
  ): Promise<void> {
    const existing = await fetchAgentById(this.db, id);
    if (!existing) {
      sendJson(res, 404, { error: `Agent with id ${id} not found` });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 400, { error: "Failed to read request body" });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const parsed = UpdateAgentBodySchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { scheduleInput, ...agentFields } = parsed.data;
    const updates: AgentUpdates = agentFields;

    if (scheduleInput !== undefined) {
      const resolved = await resolveScheduleInput(scheduleInput, this.client);
      if ("error" in resolved) {
        sendJson(res, 400, { error: resolved.error });
        return;
      }
      updates.cronExpression = resolved.cronExpression;
    }

    const updated = await updateAgent(this.db, id, updates);
    sendJson(res, 200, updated);
  }

  private async handleDeleteAgent(res: http.ServerResponse, id: number): Promise<void> {
    const deleted = await deleteAgent(this.db, id);
    if (!deleted) {
      sendJson(res, 404, { error: `Agent with id ${id} not found` });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  private async handleListExecutions(res: http.ServerResponse, id: number): Promise<void> {
    const agent = await fetchAgentById(this.db, id);
    if (!agent) {
      sendJson(res, 404, { error: `Agent with id ${id} not found` });
      return;
    }
    const executions = await listExecutionsByAgentId(this.db, id);
    sendJson(res, 200, executions);
  }
}
