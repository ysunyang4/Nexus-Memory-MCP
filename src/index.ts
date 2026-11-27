#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryStore } from "./store.js";
import { MemoryService, type MemoryScope, type MemoryType } from "./memory.js";
import { HandoffService } from "./handoff.js";

// Initialize services
const store = new MemoryStore();
const memoryService = new MemoryService(store);
const handoffService = new HandoffService(store);

// Create MCP Server
const server = new McpServer(
  {
    name: "nexus-memory-mcp",
    version: "1.0.0",
  },
  {
    instructions:
      "At the start of a new session, call `nexus_memory_bootstrap` (or read resource `nexus://memory/bootstrap`) once to inject high-importance GLOBAL and PROJECT memories (<700 tokens). Use `nexus_memory_get` for exact key/id lookup, `nexus_memory_recall` or `nexus_memory_search` for keyword search, and `nexus_memory_set` to persist durable facts, preferences, or architectural decisions (returns explicit write receipt).",
  }
);

// ============================================================
// 1. Tool: nexus_memory_set
// ============================================================
server.tool(
  "nexus_memory_set",
  "Save or update a scoped persistent memory (Global, Project, Session, Task) with automatic secret redaction and conflict resolution.",
  {
    key: z.string().describe("Unique identifier for this memory item (e.g. 'auth_architecture', 'db_choice', 'user_preference')"),
    content: z.string().describe("Detailed knowledge, decision, or fact to store"),
    type: z.enum(["FACT", "DECISION", "PREFERENCE", "CONSTRAINT", "ARCHITECTURE"]).optional().describe("Category of memory (default: 'FACT')"),
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Scope boundary (default: 'PROJECT')"),
    scopeId: z.string().optional().describe("Target project ID or path (defaults to current working directory for PROJECT scope)"),
    importance: z.number().min(1).max(10).optional().describe("Importance rating from 1 (trivial) to 10 (critical), default: 5"),
    confidence: z.number().min(0.1).max(1.0).optional().describe("Confidence score from 0.1 to 1.0 (default: 1.0)"),
    tags: z.array(z.string()).optional().describe("Optional tags for indexing and multi-tag filtering"),
  },
  async (args) => {
    try {
      const entry = memoryService.setMemory({
        key: args.key,
        content: args.content,
        type: args.type as MemoryType | undefined,
        scope: args.scope as MemoryScope | undefined,
        scopeId: args.scopeId,
        importance: args.importance,
        confidence: args.confidence,
        tags: args.tags,
      });

      const receipt = entry.receipt;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Memory '${entry.key}' ${receipt?.action || "saved"} (Scope: ${entry.scope}, Version: ${entry.version}, Redacted: ${receipt?.redacted ? `yes (${receipt.redactedCount})` : "no"})`,
                receipt,
                memory: entry,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to save memory: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 2. Tool: nexus_memory_recall
// ============================================================
server.tool(
  "nexus_memory_recall",
  "Recall and rank memories based on query keyword matching, scope isolation, importance weighting, and recency.",
  {
    query: z.string().optional().describe("Search keyword or phrase to match against keys and contents"),
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Filter by scope"),
    scopeId: z.string().optional().describe("Filter by specific scopeId/project path"),
    type: z.enum(["FACT", "DECISION", "PREFERENCE", "CONSTRAINT", "ARCHITECTURE"]).optional().describe("Filter by memory type"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    minImportance: z.number().min(1).max(10).optional().describe("Minimum importance score filter"),
    limit: z.number().min(1).max(50).optional().describe("Maximum number of results to return (default: 10)"),
  },
  async (args) => {
    try {
      const result = memoryService.recallMemories({
        query: args.query,
        scope: args.scope as MemoryScope | undefined,
        scopeId: args.scopeId,
        type: args.type as MemoryType | undefined,
        tags: args.tags,
        minImportance: args.minImportance,
        limit: args.limit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: result.total,
                memories: result.memories,
                reasoning: result.reasoning,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to recall memories: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 3. Tool: nexus_memory_list
// ============================================================
server.tool(
  "nexus_memory_list",
  "List active memories with optional scope filter.",
  {
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Scope filter"),
    scopeId: z.string().optional().describe("Project path or scope identifier"),
    limit: z.number().min(1).max(100).optional().describe("Maximum items to list (default: 50)"),
  },
  async (args) => {
    try {
      const memories = memoryService.listMemories({
        scope: args.scope as MemoryScope | undefined,
        scopeId: args.scopeId,
        limit: args.limit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: memories.length,
                memories,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to list memories: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 4. Tool: nexus_session_handoff
// ============================================================
server.tool(
  "nexus_session_handoff",
  "Package current task context into a compact handoff bundle with an 8-char handle (nx-xxxxxxxx) for cross-session and cross-model continuity (<800 tokens).",
  {
    title: z.string().describe("Descriptive title of the milestone or session phase"),
    summary: z.string().describe("Structured summary of completed work, current state, and key takeaways"),
    keyDecisions: z.array(z.string()).optional().describe("Crucial design, architectural, or technical decisions made"),
    activeFiles: z.array(z.string()).optional().describe("Key files modified or required for the next phase"),
    pendingTasks: z.array(z.string()).optional().describe("Next actionable steps for the next AI/session"),
    rawContext: z.string().max(5000).optional().describe("Optional compact error snippets or code references (up to 5000 chars)"),
    ttlHours: z.number().min(1).max(168).optional().describe("Hours until this handoff handle expires (1-168, default: 24)"),
  },
  async (args) => {
    try {
      const handoff = handoffService.createHandoff({
        title: args.title,
        summary: args.summary,
        keyDecisions: args.keyDecisions,
        activeFiles: args.activeFiles,
        pendingTasks: args.pendingTasks,
        rawContext: args.rawContext,
        ttlHours: args.ttlHours,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: "Session handoff package created successfully.",
                handle: handoff.handle,
                title: handoff.title,
                tokenEstimate: handoff.tokenEstimate,
                wakePrompt: handoff.wakePrompt,
                diskHandlePath: handoff.diskHandlePath,
                expiresAt: new Date(handoff.expiresAt).toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to create session handoff: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 5. Tool: nexus_session_resume
// ============================================================
server.tool(
  "nexus_session_resume",
  "Resume and inject prior session context using an 8-char handoff handle (or auto-read from .nexus/session_handle.txt).",
  {
    handle: z.string().optional().describe("The 8-char handle (e.g. nx-a1b2c3d4). If omitted, automatically reads .nexus/session_handle.txt"),
    releaseAfterRead: z.boolean().optional().describe("Whether to archive the handle after reading to prevent token duplication (default: true)"),
  },
  async (args) => {
    try {
      const result = handoffService.resumeHandoff(args.handle, args.releaseAfterRead ?? true);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to resume session handoff: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 6. Tool: nexus_memory_consolidate
// ============================================================
server.tool(
  "nexus_memory_consolidate",
  "Consolidate duplicate or conflicting active memories across a given scope into canonical records.",
  {
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Scope boundary to consolidate (default: 'PROJECT')"),
    scopeId: z.string().optional().describe("Project path or scope identifier"),
  },
  async (args) => {
    try {
      const result = memoryService.consolidate(
        (args.scope as MemoryScope) || "PROJECT",
        args.scopeId
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Consolidated ${result.consolidatedCount} entries, superseded ${result.supersededCount} duplicates.`,
                activeTotal: result.activeTotal,
                details: result.details,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to consolidate memories: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 7. Tool: nexus_memory_bootstrap (Session Start Digest)
// ============================================================
server.tool(
  "nexus_memory_bootstrap",
  "Load a compact (<700 tokens) digest of high-importance GLOBAL and current PROJECT memories at the start of a session.",
  {
    scopeId: z.string().optional().describe("Target project path or scope ID (defaults to current working directory)"),
    minImportance: z.number().min(1).max(10).optional().describe("Minimum importance threshold (default: 7)"),
    maxTokens: z.number().min(100).max(2000).optional().describe("Token budget cap for the digest (default: 700)"),
  },
  async (args) => {
    try {
      const summary = memoryService.getBootstrapSummary({
        scopeId: args.scopeId,
        minImportance: args.minImportance,
        maxTokens: args.maxTokens,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, ...summary }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to bootstrap memories: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 8. Tool: nexus_memory_get (Exact Key or ID Lookup)
// ============================================================
server.tool(
  "nexus_memory_get",
  "Get a single active memory by exact `id` or by `key` + `scope`.",
  {
    id: z.string().optional().describe("Exact memory ID (e.g. mem_...)"),
    key: z.string().optional().describe("Exact memory key (used when id is omitted)"),
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Scope boundary (default: 'PROJECT')"),
    scopeId: z.string().optional().describe("Project path or scope identifier"),
  },
  async (args) => {
    try {
      if (!args.id && !args.key) {
        return {
          isError: true,
          content: [{ type: "text", text: "Either `id` or `key` must be provided." }],
        };
      }
      const entry = args.id
        ? memoryService.getMemory(args.id)
        : memoryService.getMemoryByKey(args.key!, (args.scope as MemoryScope) || "PROJECT", args.scopeId);

      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, found: false, memory: null }, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, found: true, memory: entry }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to get memory: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// 9. Tool: nexus_memory_search (Alias for nexus_memory_recall)
// ============================================================
server.tool(
  "nexus_memory_search",
  "Search and rank memories by keyword, scope, type, or tags (alias of nexus_memory_recall).",
  {
    query: z.string().optional().describe("Search keyword or phrase to match against keys and contents"),
    scope: z.enum(["GLOBAL", "PROJECT", "SESSION", "TASK"]).optional().describe("Filter by scope"),
    scopeId: z.string().optional().describe("Filter by specific scopeId/project path"),
    type: z.enum(["FACT", "DECISION", "PREFERENCE", "CONSTRAINT", "ARCHITECTURE"]).optional().describe("Filter by memory type"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    minImportance: z.number().min(1).max(10).optional().describe("Minimum importance score filter"),
    limit: z.number().min(1).max(50).optional().describe("Maximum number of results to return (default: 10)"),
  },
  async (args) => {
    try {
      const result = memoryService.recallMemories({
        query: args.query,
        scope: args.scope as MemoryScope | undefined,
        scopeId: args.scopeId,
        type: args.type as MemoryType | undefined,
        tags: args.tags,
        minImportance: args.minImportance,
        limit: args.limit,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: result.total,
                memories: result.memories,
                reasoning: result.reasoning,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to search memories: ${err.message}` }],
      };
    }
  }
);

// ============================================================
// Resource: nexus://memory/bootstrap
// ============================================================
server.resource(
  "memory-bootstrap",
  "nexus://memory/bootstrap",
  {
    description: "Compact session-start digest of high-importance GLOBAL and PROJECT memories.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const summary = memoryService.getBootstrapSummary();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: summary.digest,
        },
      ],
    };
  }
);

// Start server on stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log startup info to stderr (never stdout, so stdio JSON-RPC remains clean)
  console.error("[Nexus Memory MCP] Server initialized and listening on stdio.");
}

main().catch((err) => {
  console.error("[Nexus Memory MCP] Fatal error starting server:", err);
  process.exit(1);
});
