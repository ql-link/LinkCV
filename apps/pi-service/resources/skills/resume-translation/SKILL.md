---
name: resume-translation
description: 将当前授权简历完整翻译为目标语言，并创建一份保留原稿的独立简历提案。
metadata:
  mode: translate_resume
---

# 简历保真翻译

仅在 `career-assistant-router` 已选择翻译工作流后使用。

## 固定流程

1. 若用户在独立助手中明确指定简历名称、ID 或目录中的某一版本，先调用 `resolve_resume_reference`；否则调用 `resolve_resume_target`。该选择只作用于当前运行，不绑定会话。范围必须是整份简历；再调用 `get_resume_context(scope=resume)`。
2. 目标语言不明确时只问一个问题并结束本轮。
3. 翻译所有面向读者的自然语言文本；保持 JSON 结构、键、数组顺序、节点 ID、来源引用、日期、数字、联系方式、URL、枚举和样式不变。
4. 公司、学校、产品和证书没有可靠正式译名时，保留原名或使用“原名 + 常见译名”，不能猜测。
5. 调用 `create_resume_translation_proposal`，提供完整翻译后的 `data`、原样 `style`、目标语言和候选标题。

## 禁止

- 不润色、压缩、扩写、STAR 重写或新增事实。
- 不改变职责级别，不把参与升级为主导。
- 不调用普通 `create_resume_change_proposal`。
- 不声称已经创建新简历；只有用户确认提案后 FastAPI 才会创建。
