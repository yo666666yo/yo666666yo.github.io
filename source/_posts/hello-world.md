---
title: Hello World - 博客开张
categories:
  - research
tags:
  - 杂谈
  - 博客
  - Hexo
mathjax: true
abbrlink: 76ef95e9
date: 2026-04-24 18:00:00
---

欢迎来到 **yo666666yo 的博客**。这里会记录 AI / 研究 进展，以及日常随笔。

<!-- more -->

## 为什么开这个博客

研究笔记散落在 Obsidian、Notion、GitHub Gist 四处，想做一个统一的公开记录点。Hexo + Butterfly 是目前对中文写作最友好的组合之一：写作用 Markdown，部署走 GitHub Pages，零服务器成本。

## 功能点验证

### 行内公式与块公式

爱因斯坦质能方程：$E=mc^2$

交叉熵损失：

$$
\mathcal{L}_{\text{CE}} = -\sum_{i=1}^{N} y_i \log \hat{y}_i
$$

注意力机制的 Scaled Dot-Product：

$$
\text{Attention}(Q, K, V) = \text{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right) V
$$

### 代码块（高亮 + 行号 + 复制按钮）

```python
import torch
import torch.nn.functional as F

def scaled_dot_product_attention(q, k, v, mask=None):
    d_k = q.size(-1)
    scores = torch.matmul(q, k.transpose(-2, -1)) / (d_k ** 0.5)
    if mask is not None:
        scores = scores.masked_fill(mask == 0, -1e9)
    attn = F.softmax(scores, dim=-1)
    return torch.matmul(attn, v), attn
```

### 引用与列表

> 研究的本质是提出更好的问题，而不是找更好的答案。

计划要写的系列：
1. LLM 训练栈（数据、tokenizer、attention、RLHF）
2. 多智能体强化学习笔记
3. 论文阅读精选

## 写在开头

这个博客会两条腿走路：  
🧪 **研究**：严肃的技术记录，可公式、可代码、可数据  
🌿 **生活**：阅读、观影、散步路上的随手记  

希望都能长期坚持下来。
