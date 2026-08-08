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

这种更优雅。Agent 自己判断"我做不下去了，需要人介入"，主动 handoff 给 `"user"` target，再由 termination condition 捕捉这个事件、停掉整个 team：

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

有几个点值得留意的是：

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

这两种模式与其说是实现细节上的差异，不如说是两档不同的 tolerance——这一点放到第三部分再说。

### 1.4 顺便回看一下旧 0.2 API 的 `human_input_mode`

AutoGen 0.2 的 `UserProxyAgent` 把 HITL 的策略全压在一个 `human_input_mode` 参数上：

| 取值 | 行为 |
|---|---|
| `ALWAYS` | 每次收到消息都问人（`UserProxyAgent` 的默认值） |
| `TERMINATE` | 只在收到 termination message 或达到 `max_consecutive_auto_reply` 时问 |
| `NEVER` | 永不问，完全自主 |

这个设计更加简单直观，但是把"何时问人"和"怎么问人"耦合在了同一个 agent 上。0.4 则通过`UserProxyAgent` 的`input_func`控制问人的方式，通过termination condition + team selection logic控制问人的时机。

---

## 二、Fowler 的"非确定性"与软件工程的 tolerance

最近软件体系架构课程分享了一篇敏捷开发先驱Fowler的文章。主题大致是说“智能体驱动的软件开发使得软件工程的确定性终结了”。读到这篇文章的时候我便联想到了最近学习的Autogen框架，软件工程的非确定性是否能用HITL思想改善甚至解决？因此我特地找了他2025 年 11 月 19 日的 [The Pragmatic Engineer 播客](https://newsletter.pragmaticengineer.com/p/martin-fowler)，节目标题是 "How AI will change software engineering – with Martin Fowler"。我把跟今天主题相关的几句原话摘出来：

> "It's a whole new way of thinking. It's got some interesting parallels to other forms of engineering."

> "What are the tolerances of the non-determinism that we have to deal with?"

> "We need to realize that we can't skate too close to the edge because otherwise we're going to have some bridges collapsing. We're going to have some noticeable crashes."

Fowler 的妻子是结构工程师：

> "My wife's a structural engineer. She always thinks in terms of what are the tolerances, how much extra stuff do I have to do beyond what the math tells me because I need it for tolerances."

结构工程里的 tolerance 思维可以用一句话概括：你知道材料的理论强度，但你永远按最坏情况去算余量。木头不会每根都达到手册上的杨氏模量，混凝土的实际抗压强度会随施工波动，所以工程师会在数学算出来的"刚好够"之上，再加一倍、两倍、三倍。

Fowler 的论点是，软件工程要进非确定性时代了，但软件工程师的思维范式还停在确定性时代。

### 2.1 软件工程的"确定性惯性"

确定性计算可以理解为二元的，结果要么对要么错，错了就 debug，调到对为止。我们整个学科的工具链都是搭在这个假设上的：

- **单元测试**：input X → output Y 是固定的
- **CI gate**：通过就 deploy，不通过就 fail
- **Refactoring**：行为完全不变才叫安全
- **Debugging**：bug 是可复现的，复现不了就不算 bug

但LLM 输出是本质“许愿”的。同一个 prompt 跑两次拿到不同结果在 LLM 里是 baseline。

### 2.2 Fowler 所担心的

那段访谈纪要我反复读了几遍，感觉 Fowler 最担心的不是非确定性本身——他显然觉得这是躲不掉的趋势——而是工程师对它的低估。

> "We can't skate too close to the edge."

"滑得离边缘太近"，说的是团队默认 AI 是 "deterministic-enough"，把 tolerance 余量压到极低，结果某个本不该出错的边缘场景把生产环境带崩。Fowler 特别点了 security 是 first concern——一个检测 SQL injection 的 prompt，99.5% 准确率你今天可能就敢上线了，可那 0.5% 偏偏落在拖库的攻击上，那就是 "some bridges collapsing"。

有意思的是，Fowler 自己 2011 年写过一篇 [*Eradicating Non-Determinism in Tests*](https://martinfowler.com/articles/nonDeterminism.html)——那会儿他的立场是把 non-determinism 当 bug 去根除。15 年过去立场变了，但变的不是原则，而是 non-determinism 的来源：当年是测试基础设施的脏数据 / race condition，那是能根除的；今天是 LLM 本身的统计性质，根除不掉。

### 2.3 Rakia Bensassi 的延伸：从建筑师到园丁

[Rakia Bensassi 在 Substack 上写过一篇 *The Death of the Deterministic Developer*](https://rakiabensassi.substack.com/p/the-death-of-the-deterministic-developer)，把 Fowler 的观点往更宽的方向拉了拉，提出 Plan-Driven Development 的破产：传统软工默认"项目一开始就知道所有信息"，但云时代加上 AI 时代，这个假设早就失效了。

她那个比喻挺有画面感——别再当建筑师了，开始当园丁。"You plant seeds. You see what grows. You prune what doesn't."

这种 mindset shift 落到工程实践上，其实就是把"控制论"那个反馈环嵌进系统设计的每一层：你不再是写好规则跑就完事，而是持续盯着系统输出、随时干预、必要时把人拉进来。

---

## 三、把 HITL 看成 tolerance 的工程化实现

到这里我把前两部分放一起重读，发现几个对应关系挺清楚。

HITL 不是"LLM 不够好所以加个人"的补救——它是非确定性系统的 tolerance 在工程层面的实例化。Fowler 在结构工程里说的"多算一倍余量"，搬到 agent 系统里没法翻译成"多跑两次推理"或"加大 temperature"，那些只是改了概率分布，没真正引入外部检查。真正的余量得来自异质 verifier，而最便宜也最强的那个异质 verifier，就是 human。

那 AutoGen 这两种 HITL 模式分别对应什么 tolerance？

### 3.1 模式一对应"高 cost、高 tolerance"

`UserProxyAgent` + `input_func` 是同步强约束：team 必须等人点头才能继续。这一档 tolerance 很高（人是最后的把关者），但 cost 也高（阻塞、不可序列化、延迟全看人）。

它真正适合的，是 Fowler 那种 "bridges collapsing" 级别的风险——

- **不可逆操作的确认**：发布到生产、转账、给客户发邮件
- **安全敏感**：生成的 SQL 要不要执行、生成的 shell 命令要不要 run
- **法律 / 合规检查**：合同条款、隐私字段输出前的二次确认

这类场景，应用 cannot skate close to the edge，所以宁可阻塞、宁可丢 session，也要让人 explicit 确认一下。

### 3.2 模式二对应"低 cost、低 tolerance"

`max_turns` / `HandoffTermination` 是异步弱约束：每轮 run 之间留个缝给人，但不强制人必须介入——很多时候用户只是在聊天，并没在"审批"什么。

它对应的场景：

- **长对话 chatbot**：每轮都要等用户回话，本来就是天然的 turn-by-turn 节奏
- **任务可中断**：agent 试五分钟不行了 handoff 给人，人给一行 hint，再 handoff 回去
- **跨设备 / 跨会话恢复**：今天在桌面开始的对话，明天在手机接着聊

这档 tolerance 比较"软"，但因为天生可持久化、不阻塞，反而能撑起很长很复杂的会话。它的危险在另一头：状态一旦 dump 出去，第二天 resume 时人对当时的上下文已经忘干净了，做出的决策未必真的基于上下文——这也是一种 "skating close to the edge"，只不过 edge 跑到人这边来了。

### 3.3 一张映射表

强行把两边对齐：

| 维度 | 结构工程（Fowler 类比） | AutoGen 模式一 | AutoGen 模式二 |
|---|---|---|---|
| **被保护的对象** | 桥梁、建筑 | 不可逆 / 高 stake 操作 | 长对话 / 流程任务 |
| **tolerance 来源** | 材料余量 + 检查工序 | 人在 loop 里阻塞确认 | 周期性 handoff + 人审 |
| **极限场景** | 地震、超载 | prompt injection / 恶意 SQL | LLM 跑偏 / 长期 hallucination 累积 |
| **失败代价** | 桥塌 | 直接生产事故 | 用户体验崩坏 + 信任损失 |
| **能否"裸跑"** | 可以，按理论值 | 可以（去掉 user_proxy） | 可以（让 max_turns 拉得很大） |
| **裸跑后果** | 偶尔倒一座 | 大概率某天出事 | 慢慢失控但难察觉 |

Fowler 这套类比里我觉得最该记住的，是"裸跑后果"的不可见性才是真正的危险。桥塌是一次性事件，所有人都看到了，下一座设计会改。但 LLM agent 的失败往往是慢性的、统计的、被摊到无数次用户交互里——你可能两年都没意识到 production 每天在小幅犯错，直到哪天某个客户拿着一段 racist output 的截图挂上推特。

### 3.4 设计 HITL 时的几条原则（自己的总结）

放在做 minimal-agent-harness 的语境里，我能想到几条经验性的原则：

1. **HITL 不是"要不要加"，而是"加在哪几个 cutpoint"**——一开始就把整条 trajectory 的 risk 点列出来：写文件、调外部 API、做不可逆操作、生成会被直接执行的东西，这些天然就是 HITL cutpoint。
2. **同步 HITL 只留给不可逆操作**——其余情况都走 async handoff。别图开发方便就到处插 blocking 的 `input_func`，那样系统会长得像个"半人工"的工单流，没有 agent 该有的样子。
3. **HITL 之后的"恢复成本"得算进 tolerance 预算**——`HandoffTermination` 之后人 30 分钟才回来，这段时间的 context decay、用户上下文遗忘，都是被吃掉的余量。
4. **HITL 的 fallback 也要设计**——人不回怎么办？timeout 之后默认 deny 还是默认 approve？这个默认值本身就是一个 tolerance 决定。
5. **observability 永远是 HITL 的孪生兄弟**——人之所以能介入，前提是他看得见。看不见的 agent 行为，再好的 HITL 框架也接不进来。

---

## 四、一点更宽的想法

再往后退一步看，Fowler 的核心论点其实可以这么讲：软件工程师一直在跟不确定性打交道，只是过去我们成功地把它压到了 OS 层、协议层、硬件层底下，让 application 层白白享受了三十年的"伪确定性"假期。LLM 并没有创造新的不确定性，它只是把不确定性从底层抬到了 application 层、抬到了 prompt 这一层、抬到了 user-facing 行为这一层。

抬上来之后，工程师反倒得去学结构工程师、医生、飞行员一直在用的 tolerance 思维。这事说远不远——手术室的 surgical timeout、航空的 checklist、CI 里的 review gate、金融的 4-eye principle，全是同一种思维的不同实例。HITL 在 LLM agent 里扮演的角色，和这些场景里的 review gate 没有本质区别。

唯一不太一样的是：LLM 给了我们一次重新挑 tolerance 等级的机会。过去 review gate 加在哪儿，是历史和制度定下来的；今天我们从零写一个 agent 系统，是自己在白纸上决定"哪几个 cutpoint 要 human"。从这个角度看，Fowler 那句 "we need to realize that we can't skate too close to the edge"，其实是在提醒我们：这一代工程师面对的是一个 design choice，而这个 choice 的代价，会写进未来十年的 production incident report 里。

---

## 结语

AutoGen 的两种 HITL 模式，从技术上看是 API 的两条路径，但放到 Fowler 的非确定性视角下，它们其实是 tolerance 工程化的两种方法论——一种把人当硬 gate（同步、阻塞、专供不可逆操作），一种把人当软审查（异步、可恢复、专供长会话）。

把人塞回 loop 里，不是 LLM 应用的过渡形态，而是非确定性系统绕不开的一块。想清楚这件事，可能比记住任何一个具体 API 都有用。

如果你也在做 agent 系统相关的工程，希望这篇笔记里关于 tolerance 的几点观察能对你有用。

---

**参考资料**

- [Human-in-the-Loop — AutoGen AgentChat 官方文档](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
- [agentchat.user_proxy_agent — AutoGen 0.2 文档](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/user_proxy_agent/)
- [Martin Fowler on The Pragmatic Engineer Podcast (2025-11-19)](https://newsletter.pragmaticengineer.com/p/martin-fowler)
- [Martin Fowler on Preparing for AI's Nondeterministic Computing — The New Stack](https://thenewstack.io/martin-fowler-on-preparing-for-ais-nondeterministic-computing/)
- [The Death of the Deterministic Developer — Rakia Bensassi](https://rakiabensassi.substack.com/p/the-death-of-the-deterministic-developer)
- [Eradicating Non-Determinism in Tests — Martin Fowler (2011)](https://martinfowler.com/articles/nonDeterminism.html)
