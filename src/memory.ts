import crypto from "node:crypto";
import { MemoryStore, type MemoryRecord } from "./store.js";
import { redactSensitiveTokensWithStats } from "./sanitizer.js";

export type MemoryScope = "GLOBAL" | "PROJECT" | "SESSION" | "TASK";
export type MemoryType = "FACT" | "DECISION" | "PREFERENCE" | "CONSTRAINT" | "ARCHITECTURE";

export interface SetMemoryParams {
  id?: string;
  key: string;
  content: string;
  type?: MemoryType;
  scope?: MemoryScope;
  scopeId?: string;
  importance?: number; // 1 - 10
  confidence?: number; // 0.0 - 1.0
  tags?: string[];
}

export interface RecallMemoryParams {
  query?: string;
  scope?: MemoryScope;
  scopeId?: string;
  type?: MemoryType;
  tags?: string[];
  minImportance?: number;
  limit?: number;
}

export interface MemoryWriteReceipt {
  action: "created" | "updated" | "unchanged";
  previousVersion: number | null;
  redacted: boolean;
  redactedCount: number;
}

export interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  scopeId?: string;
  importance: number;
  confidence: number;
  tags: string[];
  relations: {
    conflictsWith?: string[];
    supersedes?: string[];
  };
  version: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  receipt?: MemoryWriteReceipt;
}

export class MemoryService {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Set or update a scoped memory entry.
   */
  setMemory(params: SetMemoryParams): MemoryEntry {
    const scope: MemoryScope = params.scope || "PROJECT";
    const scopeId = params.scopeId || (scope === "GLOBAL" ? null : process.cwd());
    const cleanKey = params.key.trim();
    const redaction = redactSensitiveTokensWithStats(params.content.trim());
    const cleanContent = redaction.sanitized;
    const type: MemoryType = params.type || "FACT";
    const importance = Math.max(1, Math.min(10, params.importance ?? 5));
    const confidence = Math.max(0.1, Math.min(1.0, params.confidence ?? 1.0));
    const tags = Array.from(new Set(params.tags || [])).map((t) => t.trim().toLowerCase()).filter(Boolean);

    // Look for existing memory with the same key & scope
    const existing = this.getMemoryByKey(cleanKey, scope, scopeId || undefined);
    const now = Date.now();

    if (existing) {
      const mergedTags = tags.length ? tags : existing.tags;
      const isUnchanged =
        existing.content === cleanContent &&
        existing.type === type &&
        existing.importance === importance &&
        existing.confidence === confidence &&
        JSON.stringify(mergedTags) === JSON.stringify(existing.tags);

      if (isUnchanged) {
        return {
          ...existing,
          receipt: {
            action: "unchanged",
            previousVersion: existing.version,
            redacted: redaction.redacted,
            redactedCount: redaction.redactedCount,
          },
        };
      }

      const nextVersion = existing.version + 1;

      this.store.db
        .prepare(`
          UPDATE memories
          SET content = ?, type = ?, importance = ?, confidence = ?, tags = ?, version = ?, updated_at = ?, status = 'ACTIVE'
          WHERE id = ?
        `)
        .run(
          cleanContent,
          type,
          importance,
          confidence,
          JSON.stringify(mergedTags),
          nextVersion,
          now,
          existing.id
        );

      return {
        ...existing,
        content: cleanContent,
        type,
        importance,
        confidence,
        tags: mergedTags,
        version: nextVersion,
        updatedAt: now,
        receipt: {
          action: "updated",
          previousVersion: existing.version,
          redacted: redaction.redacted,
          redactedCount: redaction.redactedCount,
        },
      };
    }

    const id = params.id || `mem_${crypto.randomUUID()}`;
    const relations = { conflictsWith: [], supersedes: [] };

    this.store.db
      .prepare(`
        INSERT INTO memories (id, key, content, type, scope, scope_id, importance, confidence, tags, relations, status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)
      `)
      .run(
        id,
        cleanKey,
        cleanContent,
        type,
        scope,
        scopeId,
        importance,
        confidence,
        JSON.stringify(tags),
        JSON.stringify(relations),
        now,
        now
      );

    return {
      id,
      key: cleanKey,
      content: cleanContent,
      type,
      scope,
      scopeId: scopeId || undefined,
      importance,
      confidence,
      tags,
      relations,
      version: 1,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      receipt: {
        action: "created",
        previousVersion: null,
        redacted: redaction.redacted,
        redactedCount: redaction.redactedCount,
      },
    };
  }

  /**
   * Get a memory by ID.
   */
  getMemory(id: string): MemoryEntry | null {
    const row = this.store.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as MemoryRecord | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Get a memory by key, scope, and optional scopeId.
   */
  getMemoryByKey(key: string, scope: MemoryScope = "PROJECT", scopeId?: string): MemoryEntry | null {
    const targetScopeId = scopeId || (scope === "GLOBAL" ? null : process.cwd());
    const query = targetScopeId !== null
      ? "SELECT * FROM memories WHERE key = ? AND scope = ? AND scope_id = ? AND status = 'ACTIVE' LIMIT 1"
      : "SELECT * FROM memories WHERE key = ? AND scope = ? AND status = 'ACTIVE' LIMIT 1";

    const row = (targetScopeId !== null
      ? this.store.db.prepare(query).get(key, scope, targetScopeId)
      : this.store.db.prepare(query).get(key, scope)) as MemoryRecord | undefined;

    return row ? this.mapRow(row) : null;
  }

  /**
   * Recall memories with multi-attribute scoring and transparent reasoning.
   */
  recallMemories(params: RecallMemoryParams): {
    memories: MemoryEntry[];
    total: number;
    reasoning: string[];
  } {
    const limit = Math.max(1, Math.min(50, params.limit || 10));
    const targetScopeId = params.scopeId || (params.scope === "GLOBAL" ? null : process.cwd());

    let sql = "SELECT * FROM memories WHERE status = 'ACTIVE'";
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (params.scope) {
      conditions.push("scope = ?");
      bindings.push(params.scope);
    }
    if (params.scopeId !== undefined) {
      conditions.push("scope_id = ?");
      bindings.push(targetScopeId);
    }
    if (params.type) {
      conditions.push("type = ?");
      bindings.push(params.type);
    }
    if (params.minImportance) {
      conditions.push("importance >= ?");
      bindings.push(params.minImportance);
    }

    if (conditions.length > 0) {
      sql += " AND " + conditions.join(" AND ");
    }

    const rows = this.store.db.prepare(sql).all(...bindings) as MemoryRecord[];
    const entries = rows.map((r) => this.mapRow(r));

    // Keyword & Tag Matching Scoring
    const query = params.query?.trim().toLowerCase();
    const tagFilters = params.tags?.map((t) => t.trim().toLowerCase()) || [];

    const scored = entries.map((entry) => {
      let score = entry.importance * 5 * entry.confidence;

      if (query) {
        const keyMatch = entry.key.toLowerCase().includes(query);
        const contentMatch = entry.content.toLowerCase().includes(query);
        if (keyMatch) score += 15;
        if (contentMatch) score += 8;
      }

      if (tagFilters.length > 0) {
        const matchedTags = tagFilters.filter((t) => entry.tags.includes(t));
        score += matchedTags.length * 10;
      }

      // Small recency bonus (last 24 hours gets up to +3)
      const ageHours = (Date.now() - entry.updatedAt) / (1000 * 3600);
      if (ageHours < 24) score += Math.max(0, 3 - ageHours / 8);

      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, limit).map((s) => s.entry);

    const reasoning = selected.map(
      (m) => `Recalled [${m.type}] '${m.key}' (Scope: ${m.scope}, Importance: ${m.importance}, Conf: ${m.confidence})`
    );

    return {
      memories: selected,
      total: selected.length,
      reasoning,
    };
  }

  /**
   * List memories with optional filtering.
   */
  listMemories(params?: { scope?: MemoryScope; scopeId?: string; limit?: number }): MemoryEntry[] {
    const limit = Math.max(1, Math.min(100, params?.limit || 50));
    let sql = "SELECT * FROM memories WHERE status = 'ACTIVE'";
    const bindings: any[] = [];

    if (params?.scope) {
      sql += " AND scope = ?";
      bindings.push(params.scope);
    }
    if (params?.scopeId) {
      sql += " AND scope_id = ?";
      bindings.push(params.scopeId);
    }

    sql += " ORDER BY updated_at DESC LIMIT ?";
    bindings.push(limit);

    const rows = this.store.db.prepare(sql).all(...bindings) as MemoryRecord[];
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Delete memory by ID.
   */
  deleteMemory(id: string): boolean {
    const res = this.store.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return res.changes > 0;
  }

  /**
   * Consolidate duplicate or overlapping active memories across a given scope.
   */
  consolidate(scope: MemoryScope = "PROJECT", scopeId?: string): {
    consolidatedCount: number;
    supersededCount: number;
    activeTotal: number;
    details: Array<{ key: string; action: string; reason: string }>;
  } {
    const targetScopeId = scopeId || (scope === "GLOBAL" ? null : process.cwd());
    const entries = this.listMemories({ scope, scopeId: targetScopeId || undefined, limit: 1000 });

    const groups = new Map<string, MemoryEntry[]>();
    for (const mem of entries) {
      const normKey = mem.key.trim().toLowerCase();
      if (!groups.has(normKey)) groups.set(normKey, []);
      groups.get(normKey)!.push(mem);
    }

    const details: Array<{ key: string; action: string; reason: string }> = [];
    let consolidatedCount = 0;
    let supersededCount = 0;

    for (const [, group] of groups.entries()) {
      if (group.length > 1) {
        // Sort: highest importance * confidence first, then latest updated
        group.sort((a, b) => b.importance * b.confidence - a.importance * a.confidence || b.updatedAt - a.updatedAt);
        const primary = group[0];
        const duplicates = group.slice(1);

        const allTags = Array.from(new Set(group.flatMap((g) => g.tags)));
        const allContents = Array.from(new Set(group.map((g) => g.content.trim())));
        const mergedContent = allContents.join("\n---\n");

        primary.content = mergedContent;
        primary.tags = allTags;
        primary.confidence = Math.min(1.0, primary.confidence + 0.05);
        primary.importance = Math.max(...group.map((g) => g.importance));
        primary.updatedAt = Date.now();

        this.store.db
          .prepare("UPDATE memories SET content = ?, tags = ?, confidence = ?, importance = ?, updated_at = ? WHERE id = ?")
          .run(primary.content, JSON.stringify(primary.tags), primary.confidence, primary.importance, primary.updatedAt, primary.id);

        consolidatedCount++;
        details.push({
          key: primary.key,
          action: "MERGED",
          reason: `Consolidated ${duplicates.length} duplicate entries into canonical entry '${primary.id}'`,
        });

        for (const dup of duplicates) {
          this.store.db.prepare("UPDATE memories SET status = 'ARCHIVED' WHERE id = ?").run(dup.id);
          supersededCount++;
        }
      }
    }

    const countRow = this.store.db.prepare("SELECT COUNT(*) as count FROM memories WHERE status = 'ACTIVE'").get() as { count: number };

    return {
      consolidatedCount,
      supersededCount,
      activeTotal: countRow.count,
      details,
    };
  }

  /**
   * Build a deterministic, token-capped (<maxTokens) session bootstrap digest
   * combining high-importance GLOBAL and current PROJECT memories.
   */
  getBootstrapSummary(params?: { scopeId?: string; minImportance?: number; maxTokens?: number }): {
    scopeId: string;
    minImportance: number;
    globalCount: number;
    projectCount: number;
    totalActiveCount: number;
    tokenEstimate: number;
    digest: string;
  } {
    const scopeId = params?.scopeId || process.cwd();
    const minImportance = Math.max(1, Math.min(10, params?.minImportance ?? 7));
    const maxChars = Math.max(400, (params?.maxTokens ?? 700) * 4);

    const globalRows = this.store.db
      .prepare(
        "SELECT * FROM memories WHERE scope = 'GLOBAL' AND status = 'ACTIVE' AND importance >= ? ORDER BY importance DESC, updated_at DESC LIMIT 20"
      )
      .all(minImportance) as MemoryRecord[];

    const projectRows = this.store.db
      .prepare(
        "SELECT * FROM memories WHERE scope = 'PROJECT' AND scope_id = ? AND status = 'ACTIVE' AND importance >= ? ORDER BY importance DESC, updated_at DESC LIMIT 25"
      )
      .all(scopeId, minImportance) as MemoryRecord[];

    const totalRow = this.store.db
      .prepare("SELECT COUNT(*) as count FROM memories WHERE status = 'ACTIVE'")
      .get() as { count: number };

    const lines: string[] = [];
    const appendSection = (title: string, rows: MemoryRecord[]) => {
      if (rows.length === 0) return;
      lines.push(title);
      for (const r of rows) {
        const compact = r.content.replace(/\s+/g, " ").trim().slice(0, 180);
        const line = `- [${r.type}|${r.importance}] ${r.key}: ${compact}`;
        if (lines.join("\n").length + line.length + 2 > maxChars) {
          lines.push("- ... (truncated to stay within token budget; use nexus_memory_recall for details)");
          break;
        }
        lines.push(line);
      }
    };

    appendSection("## GLOBAL (High-Importance Preferences & Facts)", globalRows);
    appendSection(`## PROJECT (${scopeId})`, projectRows);

    const digest =
      lines.length > 0
        ? lines.join("\n")
        : `No active GLOBAL or PROJECT memories with importance >= ${minImportance}. (Total active memories: ${totalRow.count})`;

    return {
      scopeId,
      minImportance,
      globalCount: globalRows.length,
      projectCount: projectRows.length,
      totalActiveCount: totalRow.count,
      tokenEstimate: Math.ceil(digest.length / 4),
      digest,
    };
  }

  private mapRow(row: MemoryRecord): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      type: row.type as MemoryType,
      scope: row.scope as MemoryScope,
      scopeId: row.scope_id || undefined,
      importance: row.importance,
      confidence: row.confidence,
      tags: JSON.parse(row.tags || "[]"),
      relations: JSON.parse(row.relations || "{}"),
      version: row.version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
