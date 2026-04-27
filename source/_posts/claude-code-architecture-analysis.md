---
title: Claude Code 架构深度解析：Tool Use Loop、Context Management 与 Multi-Agent 机制
description: >-
  基于 Claude Code 源码的深度架构分析，聚焦三大核心机制：无限循环内的流式工具调用、多层分级上下文管理、
  以及多类型子代理的生命周期与协作体系。
categories:
  - 研究
tags:
  - Claude Code
  - Agent
  - LLM
  - 架构分析
  - Context Management
  - Multi-Agent
  - Tool Use
mathjax: false
abbrlink: c5cc3e48
date: 2026-04-27 03:00:00
updated: 2026-04-27 03:00:00
---

> 本文是我对 Claude Code 源码架构的阅读笔记，重点剖析三个让我印象最深的核心设计：Tool Use Loop、Context Management 和 Multi-Agent Management。

<!-- more -->

---

## 引言

Claude Code 是 Anthropic 推出的 AI 编程助手 CLI 工具。与其他 AI 编程工具（如 Cursor、GitHub Copilot）不同，Claude Code 采用了一种"模型自主决策 + 无限工具调用循环"的架构范式。

---

## 1. Tool Use Loop：无限循环内的流式工具调用

### 1.1 整体流程

Claude Code 的核心是一个**无限循环内的异步生成器**。在 `query.ts` 的 `queryLoop()` 函数中，用一个 `while(true)` 包裹了所有逻辑。只有当模型不再输出 `tool_use`、达到预算上限、或被用户中断时才会退出。

整体流程可以简化为：

```
用户输入 → 预处理（context 裁剪/压缩）→ 调用模型 API（流式输出）→ {
    如果模型输出文本（无 tool_use）：
        → 执行 stop hooks → 返回最终结果，退出
    如果模型输出 tool_use：
        → 执行工具 → 收集 tool_result → 拼回对话 → 进入下一轮迭代
}
```

每轮迭代之前，系统会做一轮 snip（裁剪过时消息）、microcompact（编辑缓存键）、collapse（折叠旧消息），以及必要时触发 auto compact（自动摘要压缩）。这些机制保证了即使在多轮工具调用后，context 也不会无限膨胀。

模型不只是回答问题，而是在一个受控的沙盒中不断思考、行动、观察反馈、再思考，直到完成任务。和 ReAct 论文里的思路有异曲同工之妙。

### 1.2 流式工具执行

Claude Code 的 `StreamingToolExecutor` 做到了**在模型 streaming 输出期间就并行执行工具调用**。

整体流程大致可以简化为：

```
模型开始 streaming →
  content_block_start (思考文本)   → 实时显示给用户
  content_block_start (tool_use_1) → 立即开始执行工具1
  content_block_start (tool_use_2) → 立即开始执行工具2 ← 如果工具1和工具2都是只读的，二者并发
  content_block_start (tool_use_3) → 排队等待（因为工具3是写操作）
  message_stop
```

工具执行期间，已完成的结果会通过 `yield` 立即发送给 UI，用户可以看到工具一个接一个地产出结果，这带来了显著的延迟收益。如果模型要调用 3 个工具，每个平均耗时 2 秒，传统串行做法需要等 6 秒，而这套方案可以压缩到约 2 秒。

### 1.3 并发控制

工具调度的核心在 `toolOrchestration.ts` 的 `partitionToolCalls()`：

- **只读工具**（如读文件、搜索代码）：标记为 `isConcurrencySafe=true`，可以并发执行，最大并发数由环境变量 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 控制（默认 10）
- **写入工具**（如编辑文件、运行 Bash 命令）：标记为 `isConcurrencySafe=false`，必须串行执行
- **混合场景**：工具被 partition 成连续的 batch，batch 内并发，batch 间串行

同时，Bash 支持**错误级联取消**。如果并行运行的多个 Bash 命令中有一个失败了，`siblingAbortController.abort('sibling_error')` 会取消所有其他正在运行的 Bash 子进程。这是因为 Bash 命令之间通常有隐式依赖（比如 `mkdir` 失败后，后面的 `cp` 就无意义了），但读文件和网络请求这类独立操作不受影响。

### 1.4 Tool Result 如何反馈回 Context

在 query loop 中，每一轮迭代结束时，有三种消息被拼回对话数组：

```typescript
const next: State = {
  messages: [
    ...messagesForQuery,      // 当前已有的对话
    ...assistantMessages,     // 模型本轮输出的 tool_use 块
    ...toolResults,           // 工具执行结果 → 以 user 消息类型拼入
  ],
}
```

 `tool_result` 以 **user 消息类型**拼入 dialogue，符合 Anthropic Messages API 的规范（`tool_use` 和 `tool_result` 必须交替出现）。这意味着下一轮 API 调用时，模型将工具执行的结果以 user 消息类型拼入context中。

### 1.5 QueryEngine：多轮对话的封装

`QueryEngine`（`QueryEngine.ts`）是对单次 query loop 的高层封装。每次 `submitMessage()` 触发一个完整的 tool use loop，内部可以产生多轮 tool call。它维护 `mutableMessages` 累积对话、管理 `maxTurns`/`maxBudgetUsd` 终止条件、处理 structured output 的重试逻辑，以及在 token 预算接近上限时自动注入 "继续"或"结束"的提示。

---

## 2. Context Management：多层分级上下文管理

### 2.1 六层 Context 管理机制

Claude Code 有六层 context 管理机制，按激进程度从低到高排列：

| 机制 | 触发时机 | 原理 | 激进程度 |
|------|---------|------|---------|
| **Snip** | 每轮 query 前 | 删除过时的 tool message，基于规则 | 保守 |
| **Microcompact** | 每轮 query 前 | 编辑 API cache key，删除未使用的 tool schema | 保守 |
| **Context Collapse** | 每轮 query 前 | 将旧消息块"折叠"成摘要行（可在 UI 展开） | 中等 |
| **Auto Compact** | token 超过阈值 | 将历史发送给 fork agent 做摘要压缩 | 激进 |
| **Reactive Compact** | API 返回 413 错误 | 收到 prompt-too-long 后的紧急压缩 | 激进 |
| **Manual Compact** | 用户手动触发 `/compact` | 同 auto compact | 激进 |

### 2.2 Auto Compact：自动摘要压缩

**触发条件**：当 token 用量超过 `effectiveContextWindow - 13000`（窗口快要爆了），且 auto compact 未被禁用时触发。同时有 circuit breaker 保护，使得连续失败 3 次后自动停止尝试，防止无限重试。

**执行流程亮点**：

1. **优先尝试 Session Memory Compaction**
2. **Fork Agent 生成摘要**：启动一个 fork 子 agent 来做摘要，子 agent 共享主 agent 的 system prompt 和 tool pool，因此可以复用 API 的 prompt cache，节省成本
3. **如果 fork 失败，fallback 到 regular streaming**
4. **Post-compact 恢复**：压缩完成后，恢复最近编辑过的文件（最多 5 个，限制 50K tokens）、恢复被调用的 skills、恢复 plan 文件、重新注入 tool 描述等

### 2.3 Snip 和 Context Collapse

**Snip**（`snipCompact.ts`）是最温和的清理方式：删除已完成的、不再需要 context 的工具调用，删除过时的进度消息，压缩重复的文件读取结果。它通过 `feature('HISTORY_SNIP')` 控制。

**Context Collapse** 介于 Snip 和 Auto Compact 之间，把大段对话折叠成一行摘要，在 UI 上仍然可以展开查看。如果 collapse 启用，auto compact 就不会触发。在遇到 413 错误时，已经 staged 的 collapse 也可以被 drain 掉来释放空间。

### 2.4 Token Budget 管理

`feature('TOKEN_BUDGET')`（`query/tokenBudget.ts`）追踪每次 API 调用的 input/output token。当接近预算时提示模型"你可以继续，也可以结束"。它还能检测边际效应递减，当模型在后续轮次中产出越来越少时，提前结束而不是继续消耗 token。

### 2.5 消息存储与恢复

Claude Code 的 transcript 存储也设计得很仔细：

- 每个 conversation turn 写入 `~/.claude/history.jsonl`
- 支持 `--resume` 恢复历史会话
- Session 持久化 + `compact_boundary` 机制支持跨 compact 的对话恢复
- 每个 subagent 有独立的 sidechain transcript（通过 `agentId` 区分）

---

## 3. Multi-Agent Management：多代理协作体系

### 3.1 Agent 类型全景

```
TaskType:
  - local_agent           → 本地 agent（AgentTool 调用）
  - local_bash            → 本地 shell 命令
  - remote_agent          → 远程 agent
  - in_process_teammate   → 进程内 teammate（TeamCreateTool）
  - local_workflow        → 本地 workflow
  - monitor_mcp           → MCP 监控
  - dream                 → 后台沉思
```

值得注意的设计点：

- **in_process_teammate** 和 local_agent 不同——teammate 在同一个进程内运行，通过 `SendMessageTool` 进行 agent 间通信，而 local_agent 通过 `runForkedAgent` 创建
- **dream** 类型暗示了后台异步思考的能力——agent 可以在后台持续工作，不阻塞主 agent
- **remote_agent** 为分布式部署预留了扩展空间

### 3.2 Agent 创建

Subagent 的创建由 `createSubagentContext()`（`forkedAgent.ts`）完成，它是 context 隔离的枢纽：

```typescript
// Sync agent: 共享 setAppState、abortController
// Async agent: 完全隔离的 context
const agentToolUseContext = createSubagentContext(parentContext, {
  options: agentOptions,
  agentId,
  messages: initialMessages,       // 独立的消息历史
  readFileState: cloneOrFresh,     // 独立的文件缓存
  abortController: agentAbortController,
  shareSetAppState: !isAsync,      // async 不共享状态
})
```

关键的设计决策：

- **Sync agents 共享 parent 的 abort signal**：用户按 Ctrl+C 会同时取消 parent 和 sync subagent
- **Async agents 有独立的 abortController**：可以后台运行，完成后再通知 parent
- **权限隔离**：subagent 的 `allowedTools` 独立于 parent，通过 `resolveAgentTools()` 解析
- **MCP 服务器隔离**：subagent 可以有自己的 MCP 服务器配置

既保证了安全性和可控性（工具权限、MCP 连接独立），又保留了灵活性（sync/async 两种模式）。

### 3.3 Coordinator Mode

`feature('COORDINATOR_MODE')`（`coordinator/coordinatorMode.ts`）引入了一个非常有趣的概念：主 agent 不再直接操作文件，而是成为 "coordinator"，通过**异步 workers** 完成所有实际工作。

Worker 的调度模型如下：

```
Coordinator (主 agent)
  ├─ AgentTool(worker) → task_id: "agent-x7q"
  ├─ AgentTool(worker) → task_id: "agent-y3k"
  │
  ├─ worker "agent-x7q" 完成 → <task-notification> → coordinator 继续指挥它
  │   SendMessage({ to: "agent-x7q", message: "fix the bug in ..." })
  │
  └─ worker "agent-y3k" 失败 → coordinator 重新生成一个新 worker
      AgentTool({ prompt: "new approach ..." })
```

这样使得coordinator 的 context 不会被具体实现细节污染，可以保持全局视角；同时 workers 可以并行工作，互不干扰。当一个 worker 失败时，coordinator 可以基于它学到的信息重新生成一个新的 worker，而不是从头再来。

这其实就是软件工程里"任务分解 + 委派"的模式应用到了 LLM agent 上。

### 3.4 Fork Subagent

Fork subagent（`forkSubagent.ts`）是一个精巧的 cache 优化设计。它的核心思路是，当你 fork 一个子 agent 时，子 agent 的 context 与父 agent 几乎相同，因此 prompt cache 可以完全命中。

具体做法是：
- 所有 tool_result 使用相同的 placeholder 文本
- 只有最后的 DIRECTIVE（任务指令）不同
- 子 agent 继承 parent 的完整 context（system prompt + conversation + tool pool）

```
Parent: ... conversation ... assistant(all_tool_uses)
Child:  ... conversation ... assistant(all_tool_uses) → user(placeholder_results..., DIRECTIVE)
                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                           所有 fork 子 agent 的这一段都相同 → cache hit
                                           只有最后的 DIRECTIVE 不同
```

这个设计把 cache hit rate 推到了极致。在大量使用 subagent 的场景下（比如 Coordinator Mode），这个优化省下的 token 成本是非常可观的。

额外还有递归 fork 保护——通过检测 `<fork-boilerplate>` tag 判断是否已经在 fork 中，避免无限嵌套。

### 3.5 Team Agent

`TeamCreateTool` / `TeamDeleteTool`（`feature('AGENT_SWARMS')`）实现了进程内 teammate 的创建和销毁。与 fork subagent 不同，teammate 在同一个进程中运行，但有自己的独立 context。通过 `SendMessageTool` 进行 agent 间通信，通过 UDS（Unix Domain Socket）进行跨进程状态同步。

### 3.6 Agent 生命周期管理

每个 subagent 都经过了严格的生命周期管理：

```
创建:
  runAgent()
  → initializeAgentMcpServers()    // 连接 agent 专属 MCP
  → executeSubagentStartHooks()    // 执行启动钩子
  → registerFrontmatterHooks()     // 注册 agent 的钩子
  → skill preloading               // 预加载 skills
  → query() loop                   // 进入核心循环

结束 (finally 块):
  → cleanup MCP servers
  → clear session hooks
  → cleanup prompt cache tracking
  → clear read file state cache
  → kill background bash tasks
  → kill monitor MCP tasks
  → release todo entry
  → unregister from Perfetto tracing
```

---

## 4. 全局数据流：把一切串起来

```
用户输入
  ↓
processUserInput()        ← 解析 slash commands、注入 skills、处理 attachments
  ↓
QueryEngine.submitMessage()
  ↓
queryLoop()               ← 核心 while(true) 循环
  ├─ snip                 ← 清理过时消息
  ├─ microcompact         ← 编辑 API cache key
  ├─ collapse             ← 折叠旧消息
  ├─ autocompact          ← token 超阈值时压缩
  ├─ callModel (stream)   ← 调用 LLM API
  │   ├─ StreamingToolExecutor ← streaming 期间并行执行工具
  │   │   ├─ 并发执行只读工具
  │   │   ├─ 串行执行写入工具
  │   │   └─ Bash 错误级联取消
  │   └─ yield tool_result (以 user 消息类型)
  ├─ tool execution       ← 非 streaming 路径下的工具执行
  ├─ attachments          ← 文件变化 / memory / skill / queue
  ├─ stop hooks           ← post-response 钩子
  └─ messages = [...messages + assistant + toolResults]
      ↓ (循环到下一轮迭代)
  Terminal (完成 / 达到限制 / 被中断)
```

---

## 5. 一点感受

从 fork subagent 的 placeholder 到 compact 的 runForkedAgent，cache 友好的思想渗透进了架构的每个细节。这种设计思维值得在任何需要长 conversation 的 LLM 应用中借鉴。

如果你也在做 AI agent 相关的工程，希望这篇笔记能给你一些启发。
