<p align="right"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></p>

# Nexus Memory MCP

> 🧠 **本地隐私持久记忆与跨模型/跨会话无感交接 MCP 服务器（[Nexus](https://github.com/ysunyang4/Nexus) 生态独立组件）**  
> *Local-First, High-Performance, Scoped Intelligence & Cross-Model Handoff*

[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Built with SQLite](https://img.shields.io/badge/Storage-SQLite_WAL-orange.svg)](https://sqlite.org)

---

## 🌟 为什么选择 Nexus Memory MCP？

目前全球 AI Agent 开发者面临两大记忆痛点：
1. **官方 Memory MCP 太简陋**：`@modelcontextprotocol/server-memory` 只是一个没有索引的扁平 JSON 知识图谱，不支持项目隔离、无法自动合并冲突，更无法做会话交接；
2. **云端商业记忆服务泄露隐私**：如 Mem0 或第三方 API，要求将用户开发代码、私密对话上传到云端，不仅按 Token 计费且存在断网与泄密隐患。

**Nexus Memory MCP** 将 Nexus 核心架构中最成熟的 **`IntelligenceStore` + `MemoryRuntime` + `SessionHandoffManager`** 剥离为轻量级独立 MCP 服务器：

* 🔒 **100% 本地隐私安全**：基于本地高性能 SQLite (WAL 模式)，所有记忆存储在本地 `~/.nexus/nexus-memory.db`，零数据上云，毫秒级读写。
* 🛡️ **物理级敏感机密脱敏**：内置 `redactSensitiveTokens` 引擎，自动过滤 API Key（`sk-...`）、Nexus Token（`lb_...`）、GitHub PAT、数据库连接密码与私钥。
* 🗂️ **多层级作用域隔离**：支持 `GLOBAL`（跨项目通用）、`PROJECT`（当前工程专属）、`SESSION`（会话级）与 `TASK`（任务级）隔离。
* 🔄 **独创跨模型会话交接（Session Handoff）**：在 Claude 中打完收工，生成一个 8 字符句柄（如 `nx-a1b2c3d4`）；打开 Cursor 或 ChatGPT，输入一行唤醒词即可瞬间恢复上下文！
* ⚡ **零-LLM 算法级压缩预算帽（<800 Tokens）**：智能提炼核心决策、活跃文件与待办清单，拒绝上下文腐化，为新模型留出最大的推理窗口。

---

## 🚀 极简配置指南 (1 分钟上手)

```bash
git clone https://github.com/ysunyang4/Nexus-Memory-MCP.git
cd Nexus-Memory-MCP
pnpm install && pnpm run build
```

### 1. Claude Desktop 配置

打开 Claude Desktop 配置文件：
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

在 `mcpServers` 中添加：

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

### 2. Cursor / VS Code / Antigravity 配置

在 MCP 设置面板添加：
* **Name**: `nexus-memory`
* **Type**: `command (stdio)`
* **Command**: `node <path-to-Nexus-Memory-MCP>/dist/index.js`

---

## 🛠️ 核心工具与资源清单

| 工具 / 资源名称 | 功能描述 | 核心参数 |
| :--- | :--- | :--- |
| `nexus_memory_bootstrap` | 新会话开局拉取高重要性 `GLOBAL` + `PROJECT` 记忆精简摘要（`<700` tokens） | `scopeId`, `minImportance`, `maxTokens` |
| `nexus_memory_set` | 写入/更新结构化记忆，自动脱敏并返回明确回执（`created`/`updated`/`unchanged`, `redacted`） | `key`, `content`, `scope`, `type`, `importance`, `confidence`, `tags` |
| `nexus_memory_get` | 按精确 `id` 或 `key + scope` 精准读取单条记忆 | `id`, `key`, `scope`, `scopeId` |
| `nexus_memory_search` / `nexus_memory_recall` | 智能检索并加权打分召回记忆，附带透明决策原因 | `query`, `scope`, `tags`, `minImportance`, `limit` |
| `nexus_memory_list` | 浏览查看指定作用域下的活跃记忆列表 | `scope`, `scopeId`, `limit` |
| `nexus_session_handoff` | 将当前会话打包压缩为交接包（`<800` tokens），生成 `nx-xxxx` 句柄 | `title`, `summary`, `keyDecisions`, `activeFiles`, `pendingTasks` |
| `nexus_session_resume` | 用句柄（或自动读取项目 `.nexus/session_handle.txt`）恢复上下文 | `handle`, `releaseAfterRead` |
| `nexus_memory_consolidate` | 自动合并重复与相似记忆，合并标签并归档过时记录 | `scope`, `scopeId` |
| `nexus://memory/bootstrap` *(Resource)* | 高重要性 `GLOBAL` 与 `PROJECT` 记忆摘要资源 | — |

---

## 💡 典型使用场景示例

### 场景一：让 AI 永远记住你的项目规范与架构决策

在对话中直接告诉 AI：
> “记住我们项目统一使用 Fastify 框架，所有物理文件访问必须走 Canonical Path 校验，这属于架构约束。”

AI 会自动调用：
```json
{
  "key": "canonical_path_requirement",
  "content": "All physical filesystem operations must be verified by Canonical Path resolver to prevent symlink traversal.",
  "type": "CONSTRAINT",
  "scope": "PROJECT",
  "importance": 10,
  "tags": ["security", "filesystem", "architecture"]
}
```
**下次新开对话时，AI 自动通过 `nexus_memory_recall` 提取到该条记忆，绝不再犯违规错误！**

---

### 场景二：跨模型无缝交接（Claude -> ChatGPT / Cursor）

1. **在 Claude 中打下里程碑**：
   > “我们今天的开发完成了用户鉴权重构。请帮我执行会话交接。”
   
   AI 调用 `nexus_session_handoff` 返回：
   ```text
   Nexus会话交接句柄: nx-3c8f1e90（用户鉴权重构完成）。请调用 nexus_session_resume 加载上下文并接续工作。
   ```

2. **在 ChatGPT / Cursor 新窗口中**：
   直接将这一句话发给新的 AI。新 AI 自动调用 `nexus_session_resume(handle="nx-3c8f1e90")`，瞬间获取：
   * 压缩至 `< 800 tokens` 的工作总结
   * 关键决策列表（如“选用 RS256 签名”）
   * 已修改核心文件（`src/auth/token.ts`, `src/auth/jwt.ts`）
   * 下一步待办（“编写单元测试并更新 Swagger 文档”）
   
   **一秒接续开发，零重复沟通，零上下文丢失！**

---

## 🧪 自动化测试验证

本项目拥有完整单元测试，覆盖脱敏、记忆增删改查、跨作用域隔离与会话交接：

```powershell
pnpm test
```
* **测试结果**：`12 tests passed (100% pass)`

---

## 🙏 致谢

Thanks to the [LINUX DO](https://linux.do/) community for its welcoming space for technical discussion and support for open-source sharing.

---

## 📄 开源许可证

本项目基于 [Apache-2.0 License](LICENSE) 开源发布。  
隶属于 [Nexus](https://github.com/ysunyang4/Nexus) 本地 AI 基础设施生态。
