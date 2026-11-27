import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/store.js";
import { MemoryService } from "../src/memory.js";
import { HandoffService } from "../src/handoff.js";
import { redactSensitiveTokens } from "../src/sanitizer.js";

describe("Nexus Memory MCP Core Engine", () => {
  let store: MemoryStore;
  let memoryService: MemoryService;
  let handoffService: HandoffService;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    memoryService = new MemoryService(store);
    handoffService = new HandoffService(store);
  });

  afterEach(() => {
    store.close();
  });

  describe("Sanitizer & Redaction", () => {
    it("should redact API keys, LB tokens, and bearer tokens", () => {
      const raw = "My key is sk-12345678901234567890abcdef and token is lb_1234567890abcdef123456 and auth is Bearer mySecretToken1234567890abcdef";
      const cleaned = redactSensitiveTokens(raw);
      expect(cleaned).not.toContain("sk-12345678901234567890abcdef");
      expect(cleaned).not.toContain("lb_1234567890abcdef123456");
      expect(cleaned).not.toContain("mySecretToken1234567890abcdef");
      expect(cleaned).toContain("[REDACTED_API_KEY]");
      expect(cleaned).toContain("[REDACTED_LB_TOKEN]");
      expect(cleaned).toContain("[REDACTED_BEARER_TOKEN]");
    });

    it("should redact database passwords and inline secrets", () => {
      const raw = "Database: postgres://admin:superSecret123@localhost:5432/mydb, password: 'myPassword'";
      const cleaned = redactSensitiveTokens(raw);
      expect(cleaned).not.toContain("superSecret123");
      expect(cleaned).not.toContain("myPassword");
      expect(cleaned).toContain("[REDACTED_PASSWORD]");
    });
  });

  describe("MemoryService", () => {
    it("should store and retrieve memories", () => {
      const mem = memoryService.setMemory({
        key: "tech_stack",
        content: "Project uses Fastify and SQLite",
        type: "ARCHITECTURE",
        scope: "PROJECT",
        tags: ["backend", "database"],
        importance: 8,
      });

      expect(mem.key).toBe("tech_stack");
      expect(mem.version).toBe(1);

      const retrieved = memoryService.getMemoryByKey("tech_stack", "PROJECT");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe("Project uses Fastify and SQLite");
      expect(retrieved?.importance).toBe(8);
      expect(retrieved?.tags).toContain("backend");
    });

    it("should update version and content on duplicate key in same scope", () => {
      memoryService.setMemory({
        key: "auth_mode",
        content: "Using Basic Auth",
        scope: "PROJECT",
      });

      const updated = memoryService.setMemory({
        key: "auth_mode",
        content: "Upgraded to OAuth 2.0 PKCE",
        scope: "PROJECT",
        importance: 9,
      });

      expect(updated.version).toBe(2);
      expect(updated.content).toBe("Upgraded to OAuth 2.0 PKCE");
      expect(updated.importance).toBe(9);
    });

    it("should isolate memories across scopes", () => {
      memoryService.setMemory({
        key: "user_name",
        content: "Global Ryan",
        scope: "GLOBAL",
      });

      memoryService.setMemory({
        key: "user_name",
        content: "Project Ryan",
        scope: "PROJECT",
        scopeId: "/my/project",
      });

      const globalMem = memoryService.getMemoryByKey("user_name", "GLOBAL");
      const projectMem = memoryService.getMemoryByKey("user_name", "PROJECT", "/my/project");

      expect(globalMem?.content).toBe("Global Ryan");
      expect(projectMem?.content).toBe("Project Ryan");
    });

    it("should recall memories with score ranking", () => {
      memoryService.setMemory({
        key: "cache_ttl",
        content: "Cache TTL is 3600 seconds",
        tags: ["performance", "cache"],
        importance: 4,
      });

      memoryService.setMemory({
        key: "redis_cluster",
        content: "Redis cluster config and caching architecture",
        tags: ["cache", "infra"],
        importance: 9,
      });

      const result = memoryService.recallMemories({
        query: "cache",
        limit: 5,
      });

      expect(result.total).toBe(2);
      // redis_cluster should be ranked first due to higher importance
      expect(result.memories[0].key).toBe("redis_cluster");
      expect(result.reasoning.length).toBe(2);
    });

    it("should consolidate duplicate memories", () => {
      // Force insert 2 memories with identical normalized keys
      memoryService.setMemory({
        id: "mem_1",
        key: "api_endpoint",
        content: "Endpoint: https://api.v1.com",
        scope: "PROJECT",
        scopeId: "test_proj",
        tags: ["v1"],
        importance: 6,
      });

      store.db
        .prepare(`
          INSERT INTO memories (id, key, content, type, scope, scope_id, importance, confidence, tags, relations, status, version, created_at, updated_at)
          VALUES ('mem_2', 'api_endpoint', 'Endpoint: https://api.v2.com', 'FACT', 'PROJECT', 'test_proj', 8, 1.0, '["v2"]', '{}', 'ACTIVE', 1, 100, 200)
        `)
        .run();

      const result = memoryService.consolidate("PROJECT", "test_proj");
      expect(result.consolidatedCount).toBe(1);
      expect(result.supersededCount).toBe(1);

      const active = memoryService.getMemoryByKey("api_endpoint", "PROJECT", "test_proj");
      expect(active?.tags).toContain("v1");
      expect(active?.tags).toContain("v2");
      expect(active?.content).toContain("api.v2.com");
    });
  });

  describe("HandoffService", () => {
    it("should create a handoff package with nx-xxxxxxxx handle and wake prompt", () => {
      const handoff = handoffService.createHandoff({
        title: "Finished auth rewrite",
        summary: "Migrated from cookie sessions to JWT tokens with refresh token rotation.",
        keyDecisions: ["Use RS256 for signing", "Token expiry set to 15m"],
        activeFiles: ["src/auth/token.ts", "src/auth/jwt.ts"],
        pendingTasks: ["Write integration tests", "Update Swagger docs"],
        ttlHours: 48,
      });

      expect(handoff.handle).toMatch(/^nx-[a-f0-9]{8}$/);
      expect(handoff.tokenEstimate).toBeGreaterThan(0);
      expect(handoff.wakePrompt).toContain(handoff.handle);
      expect(handoff.wakePrompt).toContain("Finished auth rewrite");
    });

    it("should resume a handoff and apply token cap", () => {
      const created = handoffService.createHandoff({
        title: "Database migration completed",
        summary: "Created all baseline schemas.",
        keyDecisions: ["SQLite WAL mode enabled"],
        activeFiles: ["src/db/schema.ts"],
        pendingTasks: ["Seed mock data"],
      });

      const resumed = handoffService.resumeHandoff(created.handle, true);
      expect(resumed.success).toBe(true);
      expect(resumed.handle).toBe(created.handle);
      expect(resumed.keyDecisions).toContain("SQLite WAL mode enabled");
      expect(resumed.tokenBudgetCap).toBe("< 800 tokens");
      expect(resumed.released).toBe(true);
    });

    it("should reject expired handoff handles", () => {
      const created = handoffService.createHandoff({
        title: "Quick task",
        summary: "Short lived",
        ttlHours: 1,
      });

      // Force expire
      store.db
        .prepare("UPDATE session_handoffs SET expires_at = ? WHERE handle = ?")
        .run(Date.now() - 1000, created.handle);

      expect(() => handoffService.resumeHandoff(created.handle)).toThrow(/expired/);
    });
  });

  describe("Write Receipt & Session Bootstrap", () => {
    it("should return explicit receipt on created, unchanged, updated, and redacted writes", () => {
      const first = memoryService.setMemory({
        key: "api_config",
        content: "Using key sk-12345678901234567890abcdef for local test",
        scope: "PROJECT",
        importance: 8,
      });
      expect(first.receipt).toEqual({
        action: "created",
        previousVersion: null,
        redacted: true,
        redactedCount: 1,
      });

      const unchanged = memoryService.setMemory({
        key: "api_config",
        content: "Using key [REDACTED_API_KEY] for local test",
        scope: "PROJECT",
        importance: 8,
      });
      expect(unchanged.version).toBe(1);
      expect(unchanged.receipt?.action).toBe("unchanged");

      const updated = memoryService.setMemory({
        key: "api_config",
        content: "Switched to local mock endpoint",
        scope: "PROJECT",
        importance: 9,
      });
      expect(updated.version).toBe(2);
      expect(updated.receipt).toEqual({
        action: "updated",
        previousVersion: 1,
        redacted: false,
        redactedCount: 0,
      });
    });

    it("should build a compact bootstrap summary for high-importance GLOBAL and PROJECT memories", () => {
      memoryService.setMemory({
        key: "blender_path",
        content: "Blender is installed at E:/Tools/Blender",
        scope: "GLOBAL",
        type: "PREFERENCE",
        importance: 9,
      });
      memoryService.setMemory({
        key: "minor_note",
        content: "Low importance note should be excluded",
        scope: "GLOBAL",
        importance: 3,
      });
      memoryService.setMemory({
        key: "repo_db",
        content: "SQLite WAL enabled at ~/.nexus/nexus-memory.db",
        scope: "PROJECT",
        scopeId: "/repo/nexus",
        type: "ARCHITECTURE",
        importance: 8,
      });

      const summary = memoryService.getBootstrapSummary({
        scopeId: "/repo/nexus",
        minImportance: 7,
        maxTokens: 700,
      });

      expect(summary.globalCount).toBe(1);
      expect(summary.projectCount).toBe(1);
      expect(summary.tokenEstimate).toBeLessThanOrEqual(700);
      expect(summary.digest).toContain("blender_path");
      expect(summary.digest).toContain("repo_db");
      expect(summary.digest).not.toContain("minor_note");
    });
  });
});
