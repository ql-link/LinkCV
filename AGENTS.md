# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Prototype content preference: default resume templates must use fictional sample content, currently "张三", and must not include the user's personal resume details or contact information.

Resume font preference: default resume templates should use a polished Chinese serif stack and avoid the previously removed Google CJK serif family.

Resume web font preference: optional resume fonts such as 霞鹜文楷 must be bundled as web fonts when exposed in the UI, so previews render correctly on computers without the font installed.

Resume emphasis preference: left/right resume rows must not auto-bold left-side content; only explicit Markdown emphasis such as `**text**` should render as bold.

Resume heading preference: resume Markdown headings should not auto-bold; use size, spacing, and rules for hierarchy unless the source explicitly uses bold emphasis.

Explicit Markdown bold in resume content must render visibly bold in the web preview and PDF, including with Chinese serif fonts that need synthesized bold weight.

Explicit Markdown bold should use medium weight and a slightly lighter ink than body text so the emphasis is visible without feeling overly heavy.

## 协作语言

- Multica Issue 和 GitHub Issue 的标题、正文、验收标准及面向协作者的说明必须使用中文。
- GitHub PR 的标题、正文、审核意见和审核结论必须使用中文。
- 代码标识符、文件路径、命令、API、库名和必要的技术术语可以保留英文；出现歧义时补充中文解释。
- 提交 Issue 或 PR 前必须检查语言规范；不符合时先改为中文，再进入分工、开发或审核流程。
