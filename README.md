<p align="right"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>

# Nexus Memory MCP

> 🧠 **Local-First Persistent Memory & Cross-Model Session Handoff MCP Server (part of the [Nexus](https://github.com/ysunyang4/Nexus) ecosystem)**  
> *Model-Agnostic, High-Performance, Privacy-Guaranteed Scoped Intelligence*

[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Built with SQLite](https://img.shields.io/badge/Storage-SQLite_WAL-orange.svg)](https://sqlite.org)

---

## 🌟 Why Nexus Memory MCP?

Today, AI agents suffer from two primary memory challenges:
1. **The official Memory MCP is too simplistic**: `@modelcontextprotocol/server-memory` is an unindexed flat JSON knowledge graph with no project isolation, no automatic deduplication, and zero cross-session handoff capability.
2. **Cloud memory services compromise privacy**: Solutions like Mem0 or third-party APIs require streaming your proprietary source code and sensitive conversations to external clouds, introducing token billing, latency, and data leakage risks.

**Nexus Memory MCP** extracts the battle-tested **`IntelligenceStore` + `MemoryRuntime` + `SessionHandoffManager`** from the core Nexus architecture into a lightweight, standalone MCP server:

* 🔒 **100% Local Privacy**: Backed by high-concurrency SQLite in WAL mode at `~/.nexus/nexus-memory.db`. Zero cloud dependency, microsecond reads/writes.
* 🛡️ **Physical Secret Redaction**: Built-in `redactSensitiveTokens` engine automatically sanitizes API keys (`sk-...`), Nexus tokens (`lb_...`), GitHub PATs, database credentials, and private keys before persistence.
* 🗂️ **Multi-Tier Scope Isolation**: Strict boundaries for `GLOBAL` (cross-project preferences), `PROJECT` (project-specific architecture & rules), `SESSION`, and `TASK`.
* 🔄 **Cross-Model Session Handoff**: Finish a milestone in Claude Desktop, generate an 8-character handle (`nx-a1b2c3d4`), and paste a single wake prompt into Cursor, ChatGPT, or Gemini to instantly restore full context!
* ⚡ **Zero-LLM Token Budget Cap (<800 Tokens)**: Compacts key decisions, active files, and pending tasks deterministically without consuming token budgets for summarization.

---

## 🚀 Quickstart (1 Minute Setup)

```bash
git clone https://github.com/ysunyang4/Nexus-Memory-MCP.git
cd Nexus-Memory-MCP
pnpm install && pnpm run build
```

### 1. Claude Desktop Configuration

Edit your Claude Desktop config:
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add to `mcpServers`:

```json
{
  "mcpServers": {
    "nexus-memory": {
      "command": "node",
      "args": [
        "<path-to-Nexus-Memory-MCP>/dist/index.js"
      ]
    }
  }
}
```

### 2. Cursor / VS Code / Antigravity Setup

In your MCP settings:
* **Name**: `nexus-memory`
* **Type**: `command (stdio)`
* **Command**: `node <path-to-Nexus-Memory-MCP>/dist/index.js`

---

## 🛠️ Core Tools & Resource Reference

| Tool / Resource | Description | Key Parameters |
| :--- | :--- | :--- |
| `nexus_memory_bootstrap` | Load a compact (`<700` tokens) digest of high-importance `GLOBAL` & `PROJECT` memories at session start | `scopeId`, `minImportance`, `maxTokens` |
| `nexus_memory_set` | Save/update a scoped memory with secret sanitization and an explicit write receipt (`created`/`updated`/`unchanged`, `redacted`) | `key`, `content`, `scope`, `type`, `importance`, `confidence`, `tags` |
| `nexus_memory_get` | Exact lookup of a single active memory by `id` or `key` + `scope` | `id`, `key`, `scope`, `scopeId` |
| `nexus_memory_search` / `nexus_memory_recall` | Search and rank memories with multi-attribute scoring and reasoning | `query`, `scope`, `tags`, `minImportance`, `limit` |
| `nexus_memory_list` | List active memories with optional scope filtering | `scope`, `scopeId`, `limit` |
| `nexus_session_handoff` | Package current session into a compact bundle (`<800` tokens) with an 8-char handle | `title`, `summary`, `keyDecisions`, `activeFiles`, `pendingTasks` |
| `nexus_session_resume` | Resume session context using an 8-char handle (or auto-read `.nexus/session_handle.txt`) | `handle`, `releaseAfterRead` |
| `nexus_memory_consolidate` | Merge duplicate memories, unify tags, and archive superseded records | `scope`, `scopeId` |
| `nexus://memory/bootstrap` *(Resource)* | Markdown digest of high-importance `GLOBAL` and `PROJECT` memories | — |

---

## Verification

Includes a comprehensive test suite covering secret redaction, write receipts, session bootstrap, scoped memory CRUD, score ranking, and cross-session handoffs:

```powershell
pnpm test
```
* **Status**: `12 tests passed (100% pass rate)`

---

## Acknowledgements

Thanks to the [LINUX DO](https://linux.do/) community for its welcoming space for technical discussion and support for open-source sharing.

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).  
Part of the [Nexus](https://github.com/ysunyang4/Nexus) local AI infrastructure ecosystem.
