---
title: "多智能体 LLM RL 训练：当前 landscape"
description: "梳理多智能体 LLM RL 训练相关工作，定位 AT-GRPO 的技术缺口，并整理可能的后续研究方向。"
categories:
  - 研究
tags:
  - LLM-MAS
  - MARL
  - GRPO
  - AT-GRPO
  - Agentic RL
  - credit assignment
  - RLHF
abbrlink: b7c1a984
date: 2026-04-04 00:16:58
updated: 2026-04-04 00:16:58
---

这篇笔记梳理多智能体 LLM RL 训练的当前 landscape，对比 Stronger-MAS、Dr.MAS、MARFT、MAPoRL、MHGPO、CURE、GiGPO、MASPRM、SPO 等工作，并提炼 AT-GRPO 仍未解决的技术缺口。

<!-- more -->

## 已有工作定位

```text
┌────────────────────────┬───────────────────────────────┬───────────────────────────────────────────┐
│          论文          │          解决的问题           │                 核心方法                  │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ Stronger-MAS (ICLR'26) │ GRPO分组假设在MAS下失效       │ Agent+Turn-wise grouping + tree sampling  │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ Dr.MAS (2602.08847)    │ 全局normalization致梯度不稳定 │ Agent-wise advantage normalization        │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ MARFT (2504.16129)     │ 同步假设不适用于异步LLM agent │ Flex-MG formalism                         │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ MAPoRL (ACL'25)        │ 单agent RL缺乏协作信号        │ 协作verifier + discussion reward          │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ MHGPO (2506.02718)     │ 异构agent的group PO           │ 按agent type分组advantage                 │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ CURE (NeurIPS'25)      │ coder/tester的协同进化        │ 互给reward信号，无需ground truth          │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ GiGPO (NeurIPS'25)     │ 长horizon下GRPO credit稀疏    │ 两层hierarchical advantage（token+task）  │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ MASPRM (2510.24803)    │ 多agent的过程奖励             │ Agent-aware PRM，MCTS训练                 │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ SPO (ICLR'26)          │ GRPO的group退化               │ 消除分组，persistent value tracker        │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ DAPO (2503.14476)      │ 熵坍缩+token级credit          │ Decoupled clipping + token-level gradient │
├────────────────────────┼───────────────────────────────┼───────────────────────────────────────────┤
│ Turn-PPO (2512.17008)  │ 多轮对话的advantage估计       │ Turn-level MDP reformulation              │
└────────────────────────┴───────────────────────────────┴───────────────────────────────────────────┘
```


## AT-GRPO的具体未解决问题

通过对比这些工作，AT-GRPO有三个明确的technical gap：

Gap 1: Tree sampling计算开销大，且exploration受限
- AT-GRPO每个(agent, turn)采K=4个branch → 总采样量 = K × N_agents × T_turns × E_envs
- 贪心选最高reward推进 → 可能陷入局部最优，exploration不足
- 相关但未解决：TreeRL（2506.11902）在单agent做了tree search + process reward；SPO完全消除了分组需求
- Gap：没有工作在多agent设定下解决tree sampling的效率问题

Gap 2: 无过程奖励（process reward），credit assignment粒度粗
- AT-GRPO只用turn-level的team+local reward混合（r = α·r_team + r_local, α=1固定）
- 没有step-wise的中间信号
- 相关但未解决：MASPRM做了multi-agent PRM，但假设hierarchical routing（非对称协作）；GiGPO做了hierarchical advantage但只在单agent
- Gap：没有工作在对称/异构cooperative MAS中做agent-aware process reward + hierarchical advantage

Gap 3: Team reward与local reward的平衡是静态的
- AT-GRPO的α=1完全未调优，论文也承认这是limitation
- Dr.MAS解决了normalization问题，但没解决reward mixing问题
- Gap：没有工作自适应地学习team vs local reward的权重

---

## 三个可能的research方向（需要进一步验证）

方向A：Multi-Agent Hierarchical Advantage（多agent层次化优势估计）
- 将GiGPO的group-in-group思路推广到MAS：外层group=team trajectory，内层group=per-agent-turn
- Motivation：AT-GRPO的flat grouping在长horizon下credit稀疏（和单agent GRPO的问题一样）
- 需要验证：GiGPO原文的实验是否在multi-turn agentic任务上有效

方向B：Agent-aware Process Reward for Cooperative MAS
- 将MASPRM的思路从hierarchical routing推广到cooperative异构agent
- 结合AT-GRPO的tree sampling作为MCTS的natural fit
- Motivation：tree sampling本身就在产生树结构的trajectory，天然适合训PRM

方向C：Group-Free Multi-Agent RL（消除分组依赖）
- 将SPO的persistent value tracker推广到multi-agent：per-agent value tracker
- 完全避免tree sampling的开销
- Motivation：AT-GRPO的核心困难（group size太小）可以从根本上绕过

