import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MemoryStore, type HandoffRecord } from "./store.js";
import { redactSensitiveTokens } from "./sanitizer.js";

export interface CreateHandoffParams {
  title: string;
  summary: string;
  keyDecisions?: string[];
  activeFiles?: string[];
  pendingTasks?: string[];
  rawContext?: string;
  ttlHours?: number; // 1 - 168 (default 24)
}

export interface HandoffPackage {
  handle: string;
  title: string;
  summary: string;
  keyDecisions: string[];
  activeFiles: string[];
  pendingTasks: string[];
  rawContext?: string | null;
  tokenEstimate: number;
  createdAt: number;
  expiresAt: number;
  wakePrompt: string;
  diskHandlePath?: string;
}

export class HandoffService {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Package current conversation state into a compact handoff package with an 8-char handle.
   */
  createHandoff(params: CreateHandoffParams): HandoffPackage {
    this.cleanupExpired();

    const handle = `nx-${crypto.randomBytes(4).toString("hex")}`;
    const title = redactSensitiveTokens(params.title.trim());
    const rawSummary = redactSensitiveTokens(params.summary.trim());

    const keyDecisions = (params.keyDecisions || [])
      .map((d) => redactSensitiveTokens(String(d).trim()))
      .filter(Boolean);

    const activeFiles = (params.activeFiles || [])
      .map((f) => redactSensitiveTokens(String(f).trim()))
      .filter(Boolean);

    const pendingTasks = (params.pendingTasks || [])
      .map((t) => redactSensitiveTokens(String(t).trim()))
      .filter(Boolean);

    const rawContext = params.rawContext
      ? redactSensitiveTokens(params.rawContext.slice(0, 5000).trim())
      : null;

    const ttlHours = Math.max(1, Math.min(168, params.ttlHours || 24));
    const now = Date.now();
    const expiresAt = now + ttlHours * 3600 * 1000;

    // Estimate token count (~3.5 chars / token)
    const combinedLength =
      title.length +
      rawSummary.length +
      keyDecisions.join(" ").length +
      activeFiles.join(" ").length +
      pendingTasks.join(" ").length +
      (rawContext?.length || 0);
    const tokenEstimate = Math.ceil(combinedLength / 3.5);

    this.store.db
      .prepare(`
        INSERT INTO session_handoffs (handle, title, summary, key_decisions, active_files, pending_tasks, raw_context, token_count, created_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `)
      .run(
        handle,
        title,
        rawSummary,
        JSON.stringify(keyDecisions),
        JSON.stringify(activeFiles),
        JSON.stringify(pendingTasks),
        rawContext,
        tokenEstimate,
        now,
        expiresAt
      );

    const wakePrompt = `Nexus会话交接句柄: ${handle}（${title}）。请调用 nexus_session_resume 加载上下文并接续工作。`;

    // Attempt to persist handle to local project .nexus/session_handle.txt
    let diskHandlePath: string | undefined;
    try {
      const nexusDir = path.join(process.cwd(), ".nexus");
      if (!fs.existsSync(nexusDir)) {
        fs.mkdirSync(nexusDir, { recursive: true });
      }
      diskHandlePath = path.join(nexusDir, "session_handle.txt");
      fs.writeFileSync(diskHandlePath, handle, "utf-8");
    } catch {
      // Ignored if current directory is not writable
    }

    return {
      handle,
      title,
      summary: rawSummary,
      keyDecisions,
      activeFiles,
      pendingTasks,
      rawContext,
      tokenEstimate,
      createdAt: now,
      expiresAt,
      wakePrompt,
      diskHandlePath,
    };
  }

  /**
   * Resume/Load a session handoff by handle.
   * If handle is omitted, attempts to read from .nexus/session_handle.txt.
   */
  resumeHandoff(handle?: string, releaseAfterRead = true): {
    success: boolean;
    handle: string;
    title: string;
    summary: string;
    keyDecisions: string[];
    activeFiles: string[];
    pendingTasks: string[];
    rawContext?: string | null;
    tokenBudgetCap: string;
    released: boolean;
    message: string;
  } {
    let targetHandle = handle?.trim();

    if (!targetHandle) {
      try {
        const localHandleFile = path.join(process.cwd(), ".nexus", "session_handle.txt");
        if (fs.existsSync(localHandleFile)) {
          targetHandle = fs.readFileSync(localHandleFile, "utf-8").trim();
        }
      } catch {}
    }

    if (!targetHandle) {
      throw new Error("Missing handoff handle and no active .nexus/session_handle.txt found in current directory.");
    }

    const row = this.store.db
      .prepare("SELECT * FROM session_handoffs WHERE handle = ?")
      .get(targetHandle) as HandoffRecord | undefined;

    if (!row) {
      throw new Error(`Session handoff handle '${targetHandle}' not found.`);
    }

    if (row.expires_at < Date.now()) {
      throw new Error(`Session handoff handle '${targetHandle}' has expired at ${new Date(row.expires_at).toISOString()}.`);
    }

    // Update access stats
    this.store.db
      .prepare(`
        UPDATE session_handoffs
        SET accessed_at = ?, access_count = access_count + 1, status = ?
        WHERE handle = ?
      `)
      .run(Date.now(), releaseAfterRead ? "ARCHIVED" : row.status, targetHandle);

    // Apply < 800 token budget cap on summary and lists
    const cappedSummary = row.summary.length > 1500
      ? row.summary.slice(0, 1500) + "\n...[Summary compacted to stay within 800-token budget]"
      : row.summary;

    const keyDecisions: string[] = JSON.parse(row.key_decisions || "[]").slice(0, 8);
    const activeFiles: string[] = JSON.parse(row.active_files || "[]").slice(0, 12);
    const pendingTasks: string[] = JSON.parse(row.pending_tasks || "[]").slice(0, 10);

    // Handle file archiving
    if (releaseAfterRead) {
      try {
        const handleFilePath = path.join(process.cwd(), ".nexus", "session_handle.txt");
        if (fs.existsSync(handleFilePath)) {
          const archiveDir = path.join(process.cwd(), ".nexus", "history");
          if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true });
          }
          fs.writeFileSync(
            path.join(archiveDir, `${targetHandle}_resumed_${Date.now()}.txt`),
            targetHandle,
            "utf-8"
          );
          fs.writeFileSync(handleFilePath, "", "utf-8");
        }
      } catch {}
    }

    return {
      success: true,
      handle: row.handle,
      title: row.title,
      summary: cappedSummary,
      keyDecisions,
      activeFiles,
      pendingTasks,
      rawContext: row.raw_context,
      tokenBudgetCap: "< 800 tokens",
      released: releaseAfterRead,
      message: releaseAfterRead
        ? "Successfully resumed session context. Handle released and archived."
        : "Successfully resumed session context.",
    };
  }

  /**
   * List active or expired handoff packages.
   */
  listHandoffs(includeExpired = false): Array<{
    handle: string;
    title: string;
    tokenCount: number;
    createdAt: number;
    expiresAt: number;
    isExpired: boolean;
    status: string;
  }> {
    const now = Date.now();
    const rows = this.store.db
      .prepare("SELECT * FROM session_handoffs ORDER BY created_at DESC LIMIT 50")
      .all() as HandoffRecord[];

    return rows
      .filter((r) => includeExpired || r.expires_at > now)
      .map((r) => ({
        handle: r.handle,
        title: r.title,
        tokenCount: r.token_count,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        isExpired: r.expires_at <= now,
        status: r.status,
      }));
  }

  private cleanupExpired(): void {
    const expiredCutoff = Date.now() - 7 * 24 * 3600 * 1000; // delete after 7 days
    this.store.db
      .prepare("DELETE FROM session_handoffs WHERE expires_at < ?")
      .run(expiredCutoff);
  }
}
