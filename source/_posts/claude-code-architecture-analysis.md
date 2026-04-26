---
title: Claude Code 架构深度解析：Tool Use Loop、Context Management 与 Multi-Agent 机制
description: >-
  基于 Claude Code 源码的深度架构分析，聚焦三大核心机制：无限循环内的流式工具调用、多层分级上下文管理、
  以及多类型子代理的生命周期与协作体系。本文以我的理解重新梳理这些设计，而非简单的翻译或搬运。
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

> 本文是我对 Claude Code 源码架构的阅读笔记，重点剖析三个让我印象最深的核心设计：Tool Use Loop、Context Management 和 Multi-Agent Management。所有内容都是我自己消化理解后的重新表述，而非原文翻译。

<!-- more -->

---

## 引言

Claude Code 是 Anthropic 推出的 AI 编程助手 CLI 工具。与其他 AI 编程工具（如 Cursor、GitHub Copilot）不同，Claude Code 采用了一种"模型自主决策 + 无限工具调用循环"的架构范式。最近我阅读了它的源码，三个核心模块的设计让我印象深刻，本文是我对它们的理解和总结。

---

## 1. Tool Use Loop：无限循环内的流式工具调用

### 1.1 整体流程：一个 `while(true)` 循环驱动一切

Claude Code 的核心是一个**无限循环内的异步生成器**。在 `query.ts` 的 `queryLoop()` 函数中，用一个 `while(true)` 包裹了所有逻辑。这不是通常意义上的"循环 N 次然后退出"，而是真正的无限循环——只有当模型不再输出 `tool_use`、达到预算上限、或被用户中断时才会退出。

整体流程可以简化为：

```
用户输入 → 预处理（context 裁剪/压缩）→ 调用模型 API（流式输出）→ {
    如果模型输出文本（无 tool_use）：
        → 执行 stop hooks → 返回最终结果，退出
    如果模型输出 tool_use：
        → 执行工具 → 收集 tool_result → 拼回对话 → 进入下一轮迭代
}
```

每轮迭代之前，系统会做一轮"打扫"：snip（裁剪过时消息）、microcompact（编辑缓存键）、collapse（折叠旧消息），以及必要时触发 auto compact（自动摘要压缩）。这些机制保证了即使在多轮工具调用后，context 也不会无限膨胀。

我的理解是，这个设计本质上把 LLM 当作了一个"带工具调用的推理引擎"——模型不只是回答问题，而是在一个受控的沙盒中不断思考、行动、观察反馈、再思考，直到完成任务。这跟 ReAct 论文里的思路一致，但工程实现上更加复杂。

### 1.2 流式工具执行：模型还没说完，工具已经开始跑了

这是整个架构中最让我惊叹的工程优化。Claude Code 的 `StreamingToolExecutor` 做到了**在模型 streaming 输出期间就并行执行工具调用**。

传统的做法是：等模型全部输出完毕 → 解析出所有 tool_use → 再依次执行工具。但 Claude Code 的做法不同：

```
模型开始 streaming →
  content_block_start (思考文本)   → 实时显示给用户
  content_block_start (tool_use_1) → 立即开始执行工具1
  content_block_start (tool_use_2) → 立即开始执行工具2 ← 如果工具1和工具2都是只读的，二者并发
  content_block_start (tool_use_3) → 排队等待（因为工具3是写操作）
  message_stop
```

工具执行期间，已完成的结果会通过 `yield` 立即发送给 UI，用户可以看到工具一个接一个地产出结果。这带来的延迟收益非常显著——如果模型要调用 3 个工具，每个平均耗时 2 秒，传统串行做法需要等 6 秒，而这套方案可以压缩到约 2 秒。

### 1.3 并发控制：只读并行，写入串行，出错级联取消

工具调度的核心在 `toolOrchestration.ts` 的 `partitionToolCalls()`：

- **只读工具**（如读文件、搜索代码）：标记为 `isConcurrencySafe=true`，可以并发执行，最大并发数由环境变量 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 控制（默认 10）
- **写入工具**（如编辑文件、运行 Bash 命令）：标记为 `isConcurrencySafe=false`，必须串行执行
- **混合场景**：工具被 partition 成连续的 batch，batch 内并发，batch 间串行

还有一个有趣的设计：**Bash 错误级联取消**。如果并行运行的多个 Bash 命令中有一个失败了，`siblingAbortController.abort('sibling_error')` 会取消所有其他正在运行的 Bash 子进程。这是因为 Bash 命令之间通常有隐式依赖（比如 `mkdir` 失败后，后面的 `cp` 就无意义了），但读文件和网络请求这类独立操作不受影响。

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

关键在于 `tool_result` 以 **user 消息类型**拼入 dialogue，这符合 Anthropic Messages API 的规范（`tool_use` 和 `tool_result` 必须交替出现）。这意味着下一轮 API 调用时，模型看到的是"它请求了工具 → 用户给了结果"，而不是某种特殊的系统消息。

### 1.5 QueryEngine：多轮对话的封装

`QueryEngine`（`QueryEngine.ts`）是对单次 query loop 的高层封装。每次 `submitMessage()` 触发一个完整的 tool use loop，内部可以产生多轮 tool call。它维护 `mutableMessages` 累积对话、管理 `maxTurns`/`maxBudgetUsd` 终止条件、处理 structured output 的重试逻辑，以及在 token 预算接近上限时自动注入 "继续"或"结束"的提示。

---

## 2. Context Management：多层分级上下文管理

如果说 Tool Use Loop 是 Claude Code 的心脏，那 Context Management 就是它的呼吸系统——不断吸入新信息、呼出旧信息，保持 context 窗口在健康范围内。

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

我的理解：这个分层设计的精髓在于"渐进式"——不是一次性把所有旧信息都丢掉，而是逐层收紧。像 Snip 和 Microcompact 几乎无感知地在每轮迭代前执行，只有当 token 真的不够用时才触发更激进的 Auto Compact。

### 2.2 Auto Compact：自动摘要压缩

Auto Compact 是最核心的压缩机制（`autoCompact.ts` + `compact.ts`），它的设计体现了很强的工程智慧。

**触发条件**：当 token 用量超过 `effectiveContextWindow - 13000`（即窗口快要爆了），且 auto compact 未被禁用时触发。同时有 circuit breaker 保护——连续失败 3 次后自动停止尝试，防止无限重试。

**执行流程**的亮点：

1. **优先尝试 Session Memory Compaction**：一种更轻量的压缩方式，如果够用就不走后面的重路径
2. **Fork Agent 生成摘要**：启动一个 fork 子 agent 来做摘要——这个子 agent 共享主 agent 的 system prompt 和 tool pool，因此可以复用 API 的 prompt cache，节省成本
3. **如果 fork 失败，fallback 到 regular streaming**：不做 fancy 的事，退化到基础路径保证可用性
4. **Post-compact 恢复**：压缩完成后，恢复最近编辑过的文件（最多 5 个，限制 50K tokens）、恢复被调用的 skills、恢复 plan 文件、重新注入 tool 描述等

压缩结果的结构也很有趣——在 conversation 中插入一个 `compact_boundary` marker，marker 后依次是：摘要 user 消息 → 保留的尾部消息 → 恢复的文件 → hook 结果。这个 marker 在后续的 transcript 持久化中也发挥作用，用于恢复跨 compact 的对话。

### 2.3 Snip 和 Context Collapse：轻量级的上下文清理

**Snip**（`snipCompact.ts`）是最温和的清理方式：删除已完成的、不再需要 context 的工具调用，删除过时的进度消息，压缩重复的文件读取结果（同一文件多次读取 → 只保留最新一次）。它通过 `feature('HISTORY_SNIP')` 控制。

**Context Collapse** 是介于 Snip 和 Auto Compact 之间的机制：把大段对话折叠成一行摘要，在 UI 上仍然可以展开查看。它和 Auto Compact 互斥——如果 collapse 启用，auto compact 就不会触发。在遇到 413 错误时，已经 staged 的 collapse 也可以被 drain 掉来释放空间。

### 2.4 Token Budget 管理

`feature('TOKEN_BUDGET')`（`query/tokenBudget.ts`）追踪每次 API 调用的 input/output token。当接近预算时，自动注入一条 synthetic user message 提示模型"你可以继续，也可以结束"。更巧妙的是它能检测 diminishing returns——当模型在后续轮次中产出越来越少时，提前结束而不是继续消耗 token。

### 2.5 消息存储与恢复

Claude Code 的 transcript 存储也设计得很仔细：

- 每个 conversation turn 写入 `~/.claude/history.jsonl`
- 支持 `--resume` 恢复历史会话
- Session 持久化 + `compact_boundary` 机制支持跨 compact 的对话恢复
- 每个 subagent 有独立的 sidechain transcript（通过 `agentId` 区分）

---

## 3. Multi-Agent Management：多代理协作体系

这是我读源码时花时间最多的部分。Claude Code 的 agent 体系比我想象的要复杂和精细得多。

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

这里有几个值得注意的设计点：

- **in_process_teammate** 和 local_agent 不同——teammate 在同一个进程内运行，通过 `SendMessageTool` 进行 agent 间通信，而 local_agent 通过 `runForkedAgent` 创建
- **dream** 类型暗示了后台异步思考的能力——agent 可以在后台持续工作，不阻塞主 agent
- **remote_agent** 为分布式部署预留了扩展空间

### 3.2 Agent 创建：Context 隔离的枢纽

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

这个隔离粒度让我觉得设计得非常实用——既保证了安全性和可控性（工具权限、MCP 连接独立），又保留了灵活性（sync/async 两种模式）。

### 3.3 Coordinator Mode：主 Agent 变身调度器

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

这种模式的优势很明显：coordinator 的 context 不会被具体实现细节污染，可以保持全局视角；同时 workers 可以并行工作，互不干扰。当一个 worker 失败时，coordinator 可以基于它学到的信息重新生成一个新的 worker，而不是从头再来。

这其实就是软件工程里"任务分解 + 委派"的模式应用到了 LLM agent 上。

### 3.4 Fork Subagent：最大化 Prompt Cache 复用

Fork subagent（`forkSubagent.ts`）是我认为最精巧的 cache 优化设计。它的核心思路是：当你 fork 一个子 agent 时，子 agent 的 context 与父 agent 几乎相同，因此 prompt cache 可以完全命中。

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

### 3.5 Team Agent：Agent 间通信

`TeamCreateTool` / `TeamDeleteTool`（`feature('AGENT_SWARMS')`）实现了进程内 teammate 的创建和销毁。与 fork subagent 不同，teammate 在同一个进程中运行，但有自己的独立 context。通过 `SendMessageTool` 进行 agent 间通信，通过 UDS（Unix Domain Socket）进行跨进程状态同步。

这为更复杂的多 agent 协作场景（如代码审查者 + 实现者并行工作）提供了基础设施。

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

每个 finally 块都是在做 GC（垃圾回收）。Claude Code 的设计者非常清楚：一个长时间运行的 agent 系统如果资源管理不到位，很快就会耗尽内存、文件描述符和 MCP 连接。这种对资源管理的 meticulous 态度是我从中学到的重要一课。

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

## 5. 让我印象深刻的五个工程亮点

1. **Prompt Cache 最大化**：Fork subagent 的 placeholder 设计、compact 的 `runForkedAgent` 路径、所有构建消息时都考虑 byte-identical 前缀。Cache 不是事后优化，而是被"设计"进了每一条消息的构建过程中。

2. **资源管理极其严谨**：每个 subagent 的 `finally` 块都会仔细清理 MCP 连接、hooks、文件缓存、Bash 子进程、Perfetto tracing。这种对资源生命周期的敬畏在 LLM 应用代码中并不多见。

3. **Circuit Breaker 模式**：Auto compact 连续失败 3 次后自动停止、structured output 有最大重试次数、max_output_tokens 超出后恢复限制。这些保护措施防止了级联故障。

4. **Streaming 与 Tool 执行的并行化**：在模型还在生成输出的同时就开始执行工具，这是 latency 优化的关键突破。它不是简单的"跑得快一点"，而是从架构层面把串行改成了流水线。

5. **Feature Flag 驱动的代码裁剪**：通过 Bun 的 `bun:bundle` `feature()` 宏在不同构建中剔除不需要的代码路径，实现了 dead code elimination。这意味着 Claude Code 可以针对不同场景（如桌面端 vs CLI）编译出不同能力的版本，而不需要维护多个代码分支。

---

## 6. 总结

读完 Claude Code 的源码后，我最大的感受是：**一个好的 LLM 应用不是简单的"调 API"，而是围绕 API 构建了一套完整的工程体系**。Tool Use Loop 负责"行动"，Context Management 负责"记忆的取舍"，Multi-Agent Management 负责"分工与协作"。三者配合起来，才让 Claude Code 成为了一个真正能"干活"而不仅仅是"聊天"的 AI 工具。

另一个感受是：**Prompt Cache 是被"设计"进去的，不是后来"加"上去的**。从 fork subagent 的 placeholder 到 compact 的 runForkedAgent，cache 友好的思想渗透进了架构的每个细节。这种设计思维值得在任何需要长 conversation 的 LLM 应用中借鉴。

如果你也在做 AI agent 相关的工程，希望这篇笔记能给你一些启发。
