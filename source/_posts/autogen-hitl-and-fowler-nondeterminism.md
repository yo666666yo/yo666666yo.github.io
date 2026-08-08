---
title: AutoGen 的 Human-in-the-loop 实现：从两种交互模式到 Fowler 的"非确定性"
description: >-
  拆 AutoGen AgentChat 的两种 Human-in-the-loop 模式：run 内 UserProxyAgent + input_func
  的阻塞反馈，和 run 间 max_turns / HandoffTermination 的可持久化反馈。再结合 Martin Fowler
  2025 年聊"非确定性"和 tolerance 的那期播客，谈谈我把 HITL 当成 tolerance 工程实现的一点理解。
categories:
  - 研究
tags:
  - AutoGen
  - Human-in-the-loop
  - Agent
  - Multi-Agent
  - LLM
  - Martin Fowler
  - 非确定性
  - 软件工程
mathjax: false
abbrlink: e1c9f4a2
date: 2026-05-17 22:00:00
updated: 2026-05-17 22:00:00
---

> 我先读了 AutoGen 的 Human-in-the-loop 文档，后来又听了 Martin Fowler 在 The Pragmatic Engineer 上的那期访谈。两件事放在一起，问题才变得具体：agent 什么时候应该把人拉进来，什么情况下又应该让它自己继续跑？下面先看 AutoGen 的两条实现路径，再回到 Fowler 讲的“非确定性”和 tolerance，最后写一点我自己的判断。

<!-- more -->

---

## 引言

刚接触 agent 框架时，我把 Human-in-the-loop 理解成在 tool use loop 里加一个 user agent。重读 AgentChat 文档后，我才发现真正麻烦的不是“把人接进来”，而是接入发生在哪个时刻，以及这次介入会不会把整个 team 卡住。

先分清一个分叉就够了：人是在 run 内被接进来，还是等 run 结束后再回来。两种模式的工程后果并不小。session 能不能持久化、team 会不会阻塞、UI 要怎么接，连 failure mode 都会跟着变。

Fowler 在 2025 年 11 月那期访谈里反复谈到 tolerance。这个词刚好能解释，AutoGen 为什么没有把 HITL 做成一条统一的 API。

---

## 一、AutoGen 的两种 Human-in-the-loop 模式

AutoGen 0.4 的 AgentChat 给了两条路。第一条是在 run 内让框架“叫”人提供输入；第二条是让 run 先停下来，把控制权交还给应用，下一轮 `run()` 再把人的输入作为 `task` 注入。

### 1.1 模式一：run 内反馈——`UserProxyAgent` + `input_func`

这是最直观的一条路：把 `UserProxyAgent` 放进 team 的参与者列表，至于什么时候问人，由 team 的选择逻辑（round-robin、selector prompt）决定。轮到 proxy 时，框架直接调用 `input_func` 取输入。

```python
from autogen_agentchat.agents import AssistantAgent, UserProxyAgent
from autogen_agentchat.conditions import TextMentionTermination
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.ui import Console
from autogen_ext.models.openai import OpenAIChatCompletionClient

model_client = OpenAIChatCompletionClient(model="gpt-4o-mini")
assistant = AssistantAgent("assistant", model_client=model_client)
user_proxy = UserProxyAgent("user_proxy", input_func=input)  # 默认走 console

termination = TextMentionTermination("APPROVE")
team = RoundRobinGroupChat([assistant, user_proxy], termination_condition=termination)

stream = team.run_stream(task="Write a 4-line poem about the ocean.")
await Console(stream)
```

`input_func` 的签名是 `(prompt: str, cancellation_token: CancellationToken | None) -> str`，默认就是 Python 内建的 `input`。如果把它换成基于 `await receive_json()` 的函数，console 应用也能接到 web 前端：

```python
async def _user_input(prompt: str, cancellation_token):
    data = await websocket.receive_json()
    message = TextMessage.model_validate(data)
    return message.content

user_proxy = UserProxyAgent("user_proxy", input_func=_user_input)
```

FastAPI、ChainLit 和 Streamlit 的文档里都能找到类似样例。

问题也从这里开始：team 会在 `input_func` 上阻塞。AutoGen 官方文档原话写道：

> This call blocks the execution of the team until the user provides feedback or errors out. The team's state cannot be saved or resumed during this wait.

换句话说，`UserProxyAgent` 一旦被轮到并开始等人，team state 就停在一个无法保存或恢复的中间态。Worker crash、机器重启、等待超时，任何一个都可能让这段对话直接结束。所以它更适合 approve / deny 这样的短交互，而不是需要隔夜恢复的长会话。

配套的 `UserInputRequestedEvent` 仍然有用：它至少告诉应用，proxy 当前停在了哪个等待点。

### 1.2 模式二：run 间反馈——`max_turns` 与 `HandoffTermination`

如果对话需要跨轮次、可序列化，甚至要在另一台设备上 resume，AutoGen 提供了另外两个机制。它们可以叠着用：

**(a) `max_turns`：硬性上限**

`max_turns=1` 就够构成最小的 chatbot loop：team 跑完一个 agent reply 就停，把结果交给用户；用户输入回来后，再启动下一轮。每一轮之间，team state 都可以 dump 到数据库。

```python
team = RoundRobinGroupChat([assistant], max_turns=1)

task = "Write a 4-line poem about the ocean."
while True:
    stream = team.run_stream(task=task)
    await Console(stream)
    task = input("Enter your feedback (type 'exit' to leave): ")
    if task.lower().strip() == "exit":
        break
```

turn counter 会在每次 run 时重置，但对话历史和 round-robin 的位置由 team 内部维护。`RoundRobinGroupChat`、`SelectorGroupChat` 和 `Swarm` 都支持 `max_turns`。

**(b) `HandoffTermination`：让 agent 自己决定何时要人**

另一条路把“什么时候需要人”交给 agent 自己判断。它可以主动 handoff 给 `"user"` target，再由 termination condition 捕捉事件并停掉整个 team：

```python
from autogen_agentchat.base import Handoff
from autogen_agentchat.conditions import HandoffTermination, TextMentionTermination

lazy_agent = AssistantAgent(
    "lazy_assistant",
    model_client=model_client,
    handoffs=[Handoff(target="user", message="Transfer to user.")],
    system_message=(
        "If you cannot complete the task, transfer to user. "
        "Otherwise, when finished, respond with 'TERMINATE'."
    ),
)

team = RoundRobinGroupChat(
    [lazy_agent],
    termination_condition=HandoffTermination(target="user") | TextMentionTermination("TERMINATE"),
)

await Console(team.run_stream(task="What is the weather in New York?"))
# team 停下，stop_reason 提示已 handoff 给 user
await Console(team.run_stream(task="The weather in New York is sunny."))
# 重新进入 run，agent 拿到 user 的输入继续工作
```

这里有三个容易漏掉的细节：

- termination 是复合条件 `handoff_termination | text_termination`，任意一个触发就停
- `Swarm` 在 user-handoff 之后 resume 时，`task` 必须是 `HandoffMessage`，还得指明下一步交给谁，接口比 `RoundRobinGroupChat` 严格
- state 只要 terminate 了就是干净、可序列化的，后面接什么持久化方案都行

### 1.3 两种模式的对比

| 维度 | 模式一（run 内） | 模式二（run 间） |
|---|---|---|
| **代表 API** | `UserProxyAgent` + `input_func` | `max_turns` / `HandoffTermination` |
| **team 执行** | 阻塞等待 | 完全 terminate |
| **状态可持久化** | 等待期间不可序列化 | 任意时刻可 dump |
| **谁决定要人** | team 的选择逻辑轮到 proxy | turn 上限 / termination condition |
| **输入怎么进来** | `input_func` 返回 | 下一轮 `run(task=...)` 注入 |
| **适用场景** | 同步审批、快速确认 | 长会话、异步 UI、跨设备 resume |
| **典型 failure mode** | 等待中 worker 死掉 → 会话丢失 | 重 run 时 task 注入错误 → 上下文错乱 |

所以这不只是实现细节的差异，而是两档不同的 tolerance。第三部分再回到这个判断。

### 1.4 顺便回看一下旧 0.2 API 的 `human_input_mode`

AutoGen 0.2 的 `UserProxyAgent` 把 HITL 策略集中在一个 `human_input_mode` 参数上：

| 取值 | 行为 |
|---|---|
| `ALWAYS` | 每次收到消息都问人（`UserProxyAgent` 的默认值） |
| `TERMINATE` | 只在收到 termination message 或达到 `max_consecutive_auto_reply` 时问 |
| `NEVER` | 永不问，完全自主 |

这种设计更直观，但“何时问人”和“怎么问人”都落在同一个 agent 上。0.4 把两件事拆开了：`UserProxyAgent` 的 `input_func` 负责输入方式，termination condition 和 team selection logic 负责触发时机。

---

## 二、Fowler 的"非确定性"与软件工程的 tolerance

最近在软件体系架构课程里，我听到一篇讨论 Fowler 的文章。它把智能体驱动的软件开发概括成一个很激进的判断：软件工程正在失去过去那种确定性。这个说法让我立刻想到刚读过的 AutoGen——如果 agent 的输出本来就有波动，HITL 到底能补上哪一段？

带着这个问题，我找到了 Fowler 在 2025 年 11 月 19 日参加的 [The Pragmatic Engineer 播客](https://newsletter.pragmaticengineer.com/p/martin-fowler)，节目标题是 "How AI will change software engineering – with Martin Fowler"。和这篇笔记最相关的是下面几句：

> "It's a whole new way of thinking. It's got some interesting parallels to other forms of engineering."

> "What are the tolerances of the non-determinism that we have to deal with?"

> "We need to realize that we can't skate too close to the edge because otherwise we're going to have some bridges collapsing. We're going to have some noticeable crashes."

Fowler 还提到，他的妻子是一名结构工程师：

> "My wife's a structural engineer. She always thinks in terms of what are the tolerances, how much extra stuff do I have to do beyond what the math tells me because I need it for tolerances."

结构工程里的 tolerance 思维，我理解成一句话：知道材料的理论强度，却不按“刚好够”去设计余量。木头不会每根都达到手册上的杨氏模量，混凝土的实际抗压强度也会受施工波动影响，所以工程师会在计算结果之上再留出空间。

我听下来，Fowler 的重点并不是宣布软件工程“进入新时代”，而是提醒工程师：系统的波动变得更靠近 application 层了，但我们的习惯还停留在确定性计算那一边。

### 2.1 软件工程的"确定性惯性"

确定性计算很容易被理解成二元结果：对，或者错；错了就 debug，直到调对为止。很多工具链都建立在这个前提上：

- 单元测试：input X → output Y 应该固定
- CI gate：通过就 deploy，不通过就 fail
- Refactoring：行为完全不变才算安全
- Debugging：bug 最好能复现，否则很难定位

但 LLM 输出更像“许愿”：同一个 prompt 跑两次得到不同结果，在这里反而是 baseline。

### 2.2 Fowler 所担心的

那段访谈我来回听了几遍。Fowler 真正在意的似乎不是非确定性本身——他并不认为这股趋势还能绕开——而是工程师仍然按确定性系统的习惯去估计风险。

> "We can't skate too close to the edge."

"滑得离边缘太近"，说的是团队默认 AI 是 "deterministic-enough"，把 tolerance 余量压到极低，结果某个本不该出错的边缘场景把生产环境带崩。Fowler 特别点了 security 是 first concern——一个检测 SQL injection 的 prompt，99.5% 准确率你今天可能就敢上线了，可那 0.5% 偏偏落在拖库的攻击上，那就是 "some bridges collapsing"。

有意思的是，Fowler 自己 2011 年写过一篇 [*Eradicating Non-Determinism in Tests*](https://martinfowler.com/articles/nonDeterminism.html)——那会儿他的立场是把 non-determinism 当 bug 去根除。15 年过去立场变了，但变的不是原则，而是 non-determinism 的来源：当年是测试基础设施的脏数据 / race condition，那是能根除的；今天是 LLM 本身的统计性质，根除不掉。

### 2.3 Rakia Bensassi 的延伸：从建筑师到园丁

Rakia Bensassi 在 Substack 上写过一篇 [*The Death of the Deterministic Developer*](https://rakiabensassi.substack.com/p/the-death-of-the-deterministic-developer)。她把 Fowler 的观点往更宽处推了一步，讨论 Plan-Driven Development 为什么会失效：传统软工默认“项目一开始就知道所有信息”，但云时代和 AI 时代都让这个前提变得不可靠。

她给的比喻很有画面感：别再只做建筑师，开始当园丁。“You plant seeds. You see what grows. You prune what doesn't.”

我把这个 mindset shift 放回工程实践里，看到的是一个持续反馈的设计：规则写完并不等于工作结束，还要盯着系统输出，必要时干预，必要时把人拉进来。

---

## 三、把 HITL 看成 tolerance 的工程化实现

把前两部分放在一起重读，AutoGen 的两种 HITL 模式和 Fowler 说的 tolerance 开始对上了。

HITL 不是“LLM 不够好所以加个人”的补救，而是把非确定性系统的 tolerance 落到工程层面。Fowler 在结构工程里说的“多算一倍余量”，搬到 agent 系统里不能简单变成“多跑两次推理”或“加大 temperature”。那只是改变概率分布，没有真正引入外部检查。真正的余量来自异质 verifier；成本最低、判断又最直接的那个，通常就是 human。

问题也就变成了：AutoGen 的两种 HITL 模式，各自在容忍什么风险？

### 3.1 模式一对应"高 cost、高 tolerance"

`UserProxyAgent` + `input_func` 是同步强约束：team 必须等人点头才能继续。这一档 tolerance 高，因为人是最后的把关者；代价也很明确，team 会阻塞，状态不能序列化，延迟取决于人什么时候回来。

它适合 Fowler 所说的 “bridges collapsing” 级别风险：

- 不可逆操作的确认：发布到生产、转账、给客户发邮件
- 安全敏感：生成的 SQL 要不要执行、生成的 shell 命令要不要 run
- 法律 / 合规检查：合同条款、隐私字段输出前的二次确认

这类场景不能 skate close to the edge。宁可阻塞，宁可丢掉 session，也要让人 explicit 确认一次。

### 3.2 模式二对应"低 cost、低 tolerance"

`max_turns` / `HandoffTermination` 是异步弱约束：每轮 run 之间给人留一个入口，但不强制人必须介入。很多时候用户只是在聊天，并没有审批什么高风险动作。

这条路更适合下面几种情况：

- 长对话 chatbot：每轮本来就要等用户回话，turn-by-turn 是它的自然节奏
- 任务可中断：agent 试了几分钟仍然没有进展，就 handoff 给人；人补一行 hint，再 handoff 回去
- 跨设备 / 跨会话恢复：今天在桌面开始，明天在手机接着聊

这档 tolerance 更“软”。它可持久化、不阻塞，所以能撑起长而复杂的会话；但风险也换了位置：状态 dump 出去后，第二天 resume 的人可能已经忘了当时的上下文，新的决策未必真的建立在原来的信息上。仍然是在 skating close to the edge，只是 edge 跑到了人这一边。

### 3.3 一张映射表

下面这张表不是严格等价，只是把两种模式放到同一张图里看：

| 维度 | 结构工程（Fowler 类比） | AutoGen 模式一 | AutoGen 模式二 |
|---|---|---|---|
| 被保护的对象 | 桥梁、建筑 | 不可逆 / 高 stake 操作 | 长对话 / 流程任务 |
| tolerance 来源 | 材料余量 + 检查工序 | 人在 loop 里阻塞确认 | 周期性 handoff + 人审 |
| 极限场景 | 地震、超载 | prompt injection / 恶意 SQL | LLM 跑偏 / 长期 hallucination 累积 |
| 失败代价 | 桥塌 | 直接生产事故 | 用户体验崩坏 + 信任损失 |
| 能否“裸跑” | 可以，按理论值 | 可以（去掉 user_proxy） | 可以（让 max_turns 拉得很大） |
| 裸跑后果 | 偶尔倒一座 | 大概率某天出事 | 慢慢失控但难察觉 |

这套类比里，我最想留下的是“裸跑后果”的不可见性。桥塌是一次性事件，所有人都看得到，下一座设计会改；LLM agent 的失败却可能慢慢摊进无数次用户交互。系统也许每天只错一点，直到某个客户拿着一段 racist output 的截图发到推特，团队才发现问题早就存在。

### 3.4 设计 HITL 时的几条原则（自己的总结）

放在 minimal-agent-harness 的语境里，我现在会先找 cutpoint，而不是先问“要不要加 HITL”。写文件、调外部 API、做不可逆操作、生成会被直接执行的东西，都应该先列出来。风险点列清楚，介入位置才有依据。

同步 HITL 我只会留给不可逆操作，其余情况尽量走 async handoff。为了开发方便，到处插 blocking 的 `input_func`，最后系统很容易长成“半人工”的工单流。

恢复也不是免费的。`HandoffTermination` 之后人可能 30 分钟才回来，这段时间里的 context decay 和用户上下文遗忘，都应该算进 tolerance 预算。fallback 同样要提前定：人不回时，timeout 默认 deny 还是 approve？

最后才是 observability。人能介入的前提，是先看得见 agent 在做什么；看不见的行为，再好的 HITL 框架也接不进来。

---

## 四、一点更宽的想法

再往后退一步看，Fowler 的核心论点可以这样理解：软件工程师一直在处理不确定性，只是过去我们把它压在 OS、协议和硬件这些更底层的位置，application 层因此享受了很久的“伪确定性”。LLM 没有凭空创造新的不确定性，它只是把原本藏在底层的波动推到了 application、prompt 和 user-facing 行为附近。

波动到了这一层，工程师反而得重新学习结构工程师、医生和飞行员一直在用的 tolerance 思维。手术室的 surgical timeout、航空 checklist、CI 里的 review gate、金融的 4-eye principle，看起来属于不同领域，处理的却是同一个问题：什么时候必须停下来，让另一双眼睛介入。HITL 在 LLM agent 里承担的也是这件事。

不同之处在于，LLM 给了我们重新选择 tolerance 等级的机会。过去 review gate 加在哪里，往往已经由历史和制度决定；现在从零写一个 agent 系统，我们得自己回答“哪几个 cutpoint 要 human”。Fowler 那句 "we need to realize that we can't skate too close to the edge"，说的其实就是这个 design choice：今天省下的那一道 gate，可能会在将来的 production incident report 里重新出现。

---

## 结语

AutoGen 的两种 HITL 模式，从技术上看是 API 的两条路径；放到 Fowler 的非确定性视角下，它们对应两种不同的 tolerance 设计：一种把人当硬 gate，适合同步阻塞的不可逆操作；另一种把人当软审查，适合异步、可恢复的长会话。

把人放回 loop 里，不是 LLM 应用的过渡形态，而是非确定性系统绕不开的一块。对我现在做的 agent 系统来说，这个区分比记住某一个 API 的参数更有用：先找风险 cutpoint，再决定人应该在哪个位置出现。

这也是我读完文档和 Fowler 那期访谈后，最想留下的一条判断。

---

## 参考资料

- [Human-in-the-Loop — AutoGen AgentChat 官方文档](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
- [agentchat.user_proxy_agent — AutoGen 0.2 文档](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/user_proxy_agent/)
- [Martin Fowler on The Pragmatic Engineer Podcast (2025-11-19)](https://newsletter.pragmaticengineer.com/p/martin-fowler)
- [Martin Fowler on Preparing for AI's Nondeterministic Computing — The New Stack](https://thenewstack.io/martin-fowler-on-preparing-for-ais-nondeterministic-computing/)
- [The Death of the Deterministic Developer — Rakia Bensassi](https://rakiabensassi.substack.com/p/the-death-of-the-deterministic-developer)
- [Eradicating Non-Determinism in Tests — Martin Fowler (2011)](https://martinfowler.com/articles/nonDeterminism.html)
