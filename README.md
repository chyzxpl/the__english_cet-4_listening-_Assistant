# The_PL_English_Assistant

一个 **CET-4 英语听力 AI 助手**：Dify Chatflow 工作流 + 本地 iframe 前端。

工作流能自动爬取真实英文新闻 → 按四级词表扩写成 News Report 听力正文 → 生成配套题目 → 通过 TTS 合成音频；同时支持做题技巧、考务注意事项、情感陪伴三类问答（走知识库 RAG）。

## 目录

| 路径 | 内容 |
| --- | --- |
| [`dify-agent-web/`](dify-agent-web) | 本地前端页面（iframe 嵌入 Dify 工作流）+ 完整部署手册 |
| [`dify-agent-web/workflow/`](dify-agent-web/workflow) | Dify DSL 工作流文件，导入 Dify 即可运行 |
| [`relevant_skill_and_html/`](relevant_skill_and_html) | 提示词技能库、RAG 语料、真题分析可视化页面 |

## 快速上手

完整步骤（申请 API Key、导入 DSL、部署 TTS、接入前端）都在：

**→ [`dify-agent-web/README.md`](dify-agent-web/README.md)**

简单版：

```bash
cd dify-agent-web
start.bat          # Windows 双击也行，然后打开 http://localhost:5173
```

打开后在右上角「设置」里填入你的 Dify WebApp 链接即可开始对话。

## 依赖的第三方服务

- [Dify](https://github.com/langgenius/dify) — 工作流平台
- [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) — 本地 TTS
- [Firecrawl](https://github.com/firecrawl/firecrawl) — 新闻素材爬取
