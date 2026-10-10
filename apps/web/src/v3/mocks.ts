// 需后端的示例数据：界面按 Figma 实现，但后端还没有对应字段或接口的部分，先用这里的固定数据。
// 每一项都写明缺的是什么，后端补齐后把调用处换成真实接口即可。清单与 Figma「11 说明 · 需后端清单」一致。

// 首页 · Offer 回复截止与对比（applications 没有 offer_reply_deadline 字段）
export const MOCK_OFFER = { company: "美团", deadlineLabel: "09-29 18:00 前回复", daysLeft: 2, compareCount: 2 };

// 面试日程 ·「已确认」状态（interview session 没有确认字段）
export const MOCK_SESSION_CONFIRMED = true;

// 复盘评分与步数（复盘没有 AI 评分）
export const MOCK_REVIEW_SCORE = { score: 8.2, previous: 7.6 };

// 简历模板 · 使用次数与热度排序（模板没有使用统计）

// 账号 · 注册时间、上次修改密码、当前设备、界面语言（账号接口只有 id、email、nickname、avatar_url、wechat）
export const MOCK_ACCOUNT_META = { registeredAt: "2025-03-12", passwordChangedAt: "3 个月前", device: "Mac · Chrome", language: "简体中文" };

// 分享页 · 有效期与最后更新（公开分享接口不返回这两个字段）

// 账号 · 偏好「面试提醒」（后端没有提醒设置，也没有向微信推送面试提醒的能力）
export const MOCK_ACCOUNT_PREFS = { interviewReminderOn: true, interviewReminderLabel: "提前 1 小时推送至微信" };

// 编辑资料 · 绑定微信弹窗的示例二维码种子（/api/account/wechat/bind-* 线上只对测试应用开放，先画固定图案）
export const MOCK_WECHAT_BIND_QR_SEED = "drawoffer-bind-demo";
