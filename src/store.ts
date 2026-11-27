import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MemoryRecord {
  id: string;
  key: string;
  content: string;
  type: string;
  scope: string;
  scope_id: string | null;
  importance: number;
  confidence: number;
  tags: string; // JSON array
  relations: string; // JSON object
  status: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface HandoffRecord {
  handle: string;
  title: string;
  summary: string;
  key_decisions: string; // JSON array
  active_files: string; // JSON array
  pending_tasks: string; // JSON array
  raw_context: string | null;
  token_count: number;
  created_at: number;
  expires_at: number;
  accessed_at: number | null;
  access_count: number;
  status: string;
}

export class MemoryStore {
  public readonly db: Database.Database;

  constructor(customDbPath?: string) {
    let dbPath = customDbPath || process.env.NEXUS_MEMORY_DB;
    if (!dbPath) {
      const defaultDir = path.join(os.homedir(), ".nexus");
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
      }
      dbPath = path.join(defaultDir, "nexus-memory.db");
    }

    if (dbPath === ":memory:") {
      this.db = new Database(":memory:");
    } else {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbPath);
    }

    this.initDatabase();
  }

  private initDatabase(): void {
    // Enable WAL mode and optimized settings
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");

    // 1. Memories Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'FACT',
        scope TEXT NOT NULL DEFAULT 'PROJECT',
        scope_id TEXT,
        importance INTEGER NOT NULL DEFAULT 5,
        confidence REAL NOT NULL DEFAULT 1.0,
        tags TEXT NOT NULL DEFAULT '[]',
        relations TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
      CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    `);

    // 2. Cross-Session Handoff Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_handoffs (
        handle TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        key_decisions TEXT NOT NULL DEFAULT '[]',
        active_files TEXT NOT NULL DEFAULT '[]',
        pending_tasks TEXT NOT NULL DEFAULT '[]',
        raw_context TEXT,
        token_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );

      CREATE INDEX IF NOT EXISTS idx_handoffs_status ON session_handoffs(status);
      CREATE INDEX IF NOT EXISTS idx_handoffs_expires ON session_handoffs(expires_at);
    `);
  }

  close(): void {
    this.db.close();
  }
}
