---
title: "Stronger-MAS 细读总结"
description: "围绕 Stronger-MAS / AT-GRPO 的核心问题、方法设计、训练系统、实验结果与局限进行结构化整理。"
categories:
  - 研究
tags:
  - Stronger-MAS
  - AT-GRPO
  - GRPO
  - MARL
  - LLM-MAS
  - credit assignment
abbrlink: 3d8e5b20
date: 2026-04-03 20:42:27
updated: 2026-04-03 20:42:27
---

这篇笔记细读 Stronger-MAS，重点关注 AT-GRPO 如何处理多智能体场景中 GRPO 分组假设失效的问题，以及它在训练系统、实验结论和局限上的启发。

<!-- more -->

## 1. 核心问题

标准GRPO在多智能体场景下失效，原因是分组假设被违反：
- GRPO要求同一group内所有candidate共享相同的prompt
- 但在MAS中，不同agent有不同的role prompt，不同turn有不同的interaction history
- 直接用GRPO训MAS → advantage估计偏差 →
  训练不稳定甚至性能下降（实验证实：Qwen3-8B在CodeContests上17.60→10.30，OlympiadBench 56.50→53.20）

## 2. AT-GRPO方法（三个核心设计）

### A. Tree-structured Sampling（树形采样）
- 问题：如果用并行采样（K条完整轨迹），当t>1时每个(agent, turn)组合只有1个样本，GRPO的variance reduction失效
- 解决：在每个turn的每个agent处，从当前状态分支出K个candidate action → 形成有效的size-K comparison group
- 用贪心选择（取reward最高的action）推进环境状态到下一step

### B. Agent- and Turn-wise Grouping（按agent×turn分组）
- Group key = hash(environment_id, agent_id, turn_id)
- 确保同一group内的所有candidate共享完全相同的observation（满足GRPO的identical-prompt假设）
- 是GiGPO（Group-in-Group PO）在多智能体设定下的自然推广

### C. Agent-wise Credit Assignment（混合奖励）
- r_{t,i} = α · r_team + r_i^loc
- team reward：全局任务成功信号
- local reward：agent-specific的子任务评估（如coder的pass rate vs tester的测试质量）
- α=1，未做精细调优

## 3. 训练系统设计

- 每个policy有独立的GPU Resource Pool（RolloutWorker + UpdateWorker）
- CPU Environment Pool执行环境交互（沙盒化）
- Router根据agent-policy映射分发轨迹数据
- 支持两种模式：
  - Role-sharing（M=1）：所有agent共享一个policy，数据pooled
  - Role-specialized（M=N）：每个role独立policy，独立更新

## 4. 关键实验结果

```text
┌─────────────────────────────────────┬─────────────────────────────────────────────────────┐
│                发现                 │                        证据                         │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ AT-GRPO在长horizon任务提升巨大      │ Plan-Path: 5%→96%, Sokoban: 0%→96% (8B)             │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ MAS+GRPO有时反而伤害性能            │ CodeContests 17.60→10.30, OlympiadBench 56.50→53.20 │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ SA训练后组合 vs MAS联合训练差距巨大 │ Plan-Path: 16% vs 96%（Ablation Table 4）           │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ 交换role-specialized policies后崩溃 │ 96%→6%，说明学到了互补的专业化                      │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ 训练中turn数减少                    │ agent协作效率随训练提升                             │
├─────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Scalability                         │ 7-agent时AT-GRPO 47.7% vs GRPO 34.1%（后者饱和）    │
└─────────────────────────────────────┴─────────────────────────────────────────────────────┘
```


## 5. Role-sharing vs Role-specialized的选择

- 高角色异质性（coding: coder vs tester）→ role-specialized更好（+3.05pts）
- 角色有overlap（math: reasoner vs tool-user）→ shared policy可能更好（OlympiadBench 39.6% vs 35.2%）
- 已饱和任务（game/plan）→ 无显著差异

## 6. 与其他MARL框架对比

```text
┌─────────────────────────┬────────────────────────────────────────────────────────┐
│        对比对象         │                    Stronger-MAS优势                    │
├─────────────────────────┼────────────────────────────────────────────────────────┤
│ MAPORL（同质agent辩论） │ 异质角色更好，untrained MAS 84.4% > trained MAPORL 81% │
├─────────────────────────┼────────────────────────────────────────────────────────┤
│ MARFT（单轮偏好优化）   │ 多轮交互纠错 > 单步alignment                           │
├─────────────────────────┼────────────────────────────────────────────────────────┤
│ CURE（单轮code+test）   │ 迭代self-refinement cycle                              │
└─────────────────────────┴────────────────────────────────────────────────────────┘
```


## 7. 论文的Gap/局限

1. 奖励设计仍然是手工的：每个domain需要精心设计local reward（coder pass rate, tester quality等），没有自动化
2. 仅测试了小模型（1.7B, 8B），大模型（70B+）的scaling behavior未知
3. tree sampling的计算开销：每个agent每个turn采K=4个candidate，成本随agent数和turn数线性增长
4. α=1未调优：team reward和local reward的平衡可能task-specific
5. 只测了cooperative场景，competitive/mixed-motive未涉及
6. 通信/信息传递未显式优化：agent间通过自然语言交互，没有优化"该传什么信息"

