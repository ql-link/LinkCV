# LinkCV 微信小程序

这是可独立导入微信开发者工具的原生小程序工程。运行时只依赖已部署的 LinkCV FastAPI 服务，不依赖 Web 前端工程。

## 已实现范围

- 直接打开后通过 `wx.login` 自动创建或复用普通账号，无登录、注册或资料表单。
- 扫描 LinkCV 网页小程序码后进入确认页，可确认或取消本次网页登录。
- 登录后只读查看本人简历列表和详情。
- 小程序使用 Bearer access token 和轮换 refresh token；不接收 Web Cookie。
- 不提供简历创建、编辑、删除、导出、分享、账号绑定或管理员入口。

## 导入开发者工具

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本目录 `apps/miniprogram`，不要选择仓库根目录。
3. AppID 使用 `project.config.json` 中的项目 AppID；如果实际发布主体不同，先替换为该主体的小程序 AppID。
4. 本地联调默认访问 `http://127.0.0.1:8000`。开发者工具中需要临时关闭“校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。
5. 启动后端并配置与小程序 AppID 配对的 `WECHAT_APPID` 和 `WECHAT_SECRET`，再测试自动登录、扫码确认和简历读取。

## 体验版与正式版

发布前修改 `config/runtime.js`：

```js
module.exports = {
  apiBaseUrl: "https://你的-api-域名",
};
```

该地址是小程序包内公开的 API 根地址，不是密钥。体验版和正式版会拒绝 HTTP 地址。`WECHAT_SECRET` 只能保存在后端私密环境中，禁止写入本目录。

还必须在微信公众平台完成：

1. 把 API 主机登记为 request 合法域名，并保证公网 HTTPS 证书有效。
2. 确认后端 `WECHAT_APPID/WECHAT_SECRET` 与待发布小程序完全匹配。
3. 配置小程序名称、图标、服务类目、用户隐私保护指引和必要的用户协议。
4. 上传体验版，使用真实微信完成直接打开、自动建号、扫码确认、扫码取消、会话续期、本人简历和越权详情测试。
5. 在管理端停用测试普通账号，确认 Web 与小程序会话都立即失效；同时确认管理员仍只能从 Web `/admin/login` 登录。
6. 真机验收通过后再提交微信审核和发布。

完整人工验收步骤见仓库 `.specs/LCV-61/manual_acceptance.md`。

## 本地自动化测试

在仓库根目录运行：

```bash
npm run test:miniprogram
```

这些测试覆盖运行环境配置、token 续期并发与失败行为，以及简历只读映射；它们不能替代微信开发者工具和真机验收。
