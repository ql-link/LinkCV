# LinkCV 微信小程序

这是可独立导入微信开发者工具的原生小程序工程。登录、列表和简历预览图下载依赖 LinkCV FastAPI；简历详情在当前小程序页面内展示由正式版本生成的智能一页图片。

## 已实现范围

- 直接打开后先用当前微信临时 code 只读判断是否已有 LinkCV 账号，并分别展示“同意并登录”或“同意并注册”；状态查询不建号、不发 session。用户查看并勾选小程序隐私保护指引、主动点击注册后，才允许创建普通账号；后端也会拒绝未携带确认标记的首次建号请求。
- 扫描 LinkCV 网页小程序码后进入确认页；未同意隐私指引时不能创建账号或确认网页登录，用户仍可取消本次登录。
- 登录后只读查看本人简历列表；详情读取最新手动保存版本（没有时读取初始版本），以唯一的智能一页高清图片显示，不展示未手动保存的草稿。
- 服务端临时生成文字 PDF 并转成 PNG，响应完成后不保留 PDF 或 PNG 成品。同一版本的 PNG 首次下载后保存到 `wx.env.USER_DATA_PATH`，再次打开直接使用本地文件；版本变化、文件损坏、退出登录或切换账号时自动更新或清理。
- 小程序使用 Bearer access token 和轮换 refresh token；不接收 Web Cookie。refresh 失效后的恢复只尝试登录已有账号，不会静默注册。
- 不提供简历创建、编辑、删除、导出、分享、账号绑定或管理员入口。

## 导入开发者工具

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本目录 `apps/miniprogram`，不要选择仓库根目录。
3. AppID 使用 `project.config.json` 中的项目 AppID；如果实际发布主体不同，先替换为该主体的小程序 AppID。
4. 开发版默认访问 API `http://127.0.0.1:8000`。服务在其他内网地址时，在开发者工具控制台执行 `wx.setStorageSync("linkcv_api_base_url", "http://<内网地址>:8000")`，重新进入小程序即可；覆盖只在 `develop` 生效。开发者工具中还需临时关闭合法域名校验。
5. 根级 `npm run dev:local` / `npm run dev:development` 会监听构建 PDF CLI；若单独启动后端，先执行 `npm --prefix apps/web run build:pdf-cli`。
6. 在微信公众平台配置并发布“小程序用户隐私保护指引”；启动后端并配置与小程序 AppID 配对的 `WECHAT_APPID` 和 `WECHAT_SECRET`，再测试协议查看、登录/注册、扫码确认和简历读取。

## 体验版与正式版

`config/runtime.js` 已按运行环境拆分地址：

```js
module.exports = {
  developmentApiBaseUrl: "http://127.0.0.1:8000",
  productionApiBaseUrl: "https://linkresume.cn",
};
```

该地址是小程序包内公开的服务根地址，不是密钥。体验版和正式版忽略开发者工具中的本地存储覆盖，并拒绝 HTTP 地址。通过第三方平台代开发时可用 ext config 的 `apiBaseUrl` 覆盖；普通开发者工具联调优先使用上面的本地存储方式。`WECHAT_SECRET` 只能保存在后端私密环境中，禁止写入本目录。

还必须在微信公众平台完成：

1. 把 `https://linkresume.cn` 同时登记为 request 与 downloadFile 合法域名，并保证公网 HTTPS 证书有效；不需要业务域名。
2. 确认后端 `WECHAT_APPID/WECHAT_SECRET` 与待发布小程序完全匹配。
3. 配置小程序名称、图标、服务类目并发布用户隐私保护指引；当前客户端使用微信原生 `wx.openPrivacyContract` 展示该指引，不包含自建协议页面。
4. 上传体验版，使用真实微信确认隐私门禁、扫码确认/取消、会话续期，并逐项验证全部模板、复杂布局、私有图片、首次下载、页面内图片浏览、同版本本地复用和普通 Web PDF 导出回归。
5. 在管理端停用测试普通账号，确认 Web 与小程序会话都立即失效；同时确认管理员仍只能从 Web `/admin/login` 登录。
6. 真机验收通过后再提交微信审核和发布。

本次简历同源预览的人工验收记录见仓库 `.specs/LOCAL-20260822-MINIPROGRAM-RESUME-PARITY/manual_acceptance.md`。

## 本地自动化测试

在仓库根目录运行：

```bash
npm run test:miniprogram
```

这些测试覆盖运行环境配置、隐私同意门禁、token 续期并发与失败行为，以及 PNG 下载、本地版本缓存和并发打开；它们不能替代微信开发者工具和真机验收。
