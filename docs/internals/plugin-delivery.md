# 浏览器插件制品架构

## 架构职责

插件制品子系统管理单一当前浏览器扩展 ZIP 的校验、发布、下架、重新上架、替换和私有下载。它不编译 `apps/extension` 源码，不保存历史版本，也不提供回滚。

采集插件本身见 [浏览器插件架构](extension.md)，接口见 [HTTP 接口契约](../api/http-contracts.md)。

## 组件入口

- `modules/plugin_releases/validator.py`：ZIP 安全结构、Manifest V3、文件大小和三段数字版本校验。
- `service.py`：私有对象、当前发布指针和生命周期操作。
- `routes.py`：登录用户读取当前版本和受保护下载。
- `admin_routes.py`：管理员上传、下架、上架和永久删除。
- Web `PluginReleasePanel.tsx`：管理入口；求职记录页通过 `PluginInstallDialog.tsx` 提供用户安装说明与当前版本下载，导入成功后从求职记录下钻到完整岗位。

## 存储与生命周期

制品位于私有对象存储，当前状态由 `system/plugin-releases/current.json` 指针描述。上传新版本先写制品再切换指针，并尽力清理非当前 ZIP；清理失败返回待清理状态，不回滚新版本。下架保留当前制品并关闭普通下载，重新上架复用制品，永久删除同时删除当前 ZIP 与指针。

普通用户只能通过 FastAPI 获取当前可用版本，不能获得对象存储直链。因为当前没有版本索引，已替换或永久删除的制品不能从本模块恢复。

## 发布流程

1. 管理端先检查 `.zip` 与客户端大小上限，再以 multipart 上传。
2. 后端完整读取受限大小内容，校验 ZIP 路径安全、Manifest V3、版本格式和摘要。
3. Service 写入版本对象，随后写入当前指针；同版本不同摘要或版本倒退被拒绝。
4. 当前指针切换成功后尽力清理旧 ZIP；清理失败只标记 `cleanup_pending`。
5. 普通用户先查询 current，再通过带身份校验的版本下载路由取得 ZIP。

## 权限与失败边界

- 上传、下架、重新上架和永久删除只允许管理员；当前版本查询和下载要求登录用户。
- 指针缺失表示未发布；指针 JSON 无效、对象缺失、大小或 SHA-256 不一致视为存储异常，不能返回猜测下载地址。
- 新对象写入失败不改变旧指针；指针写入失败可能留下未引用 ZIP，但不会把半成品暴露为 current。
- 下架不删除 ZIP；永久删除是不可恢复操作，管理端必须二次确认。

## 扩展边界

历史版本、灰度、签名和回滚需要新的数据模型与保留策略。ZIP 或 Manifest 规则变化时同步插件构建约束、后端校验、管理端提示和 HTTP 契约。

## 修改联动与验证

修改包结构、版本、对象键或生命周期时，需同步 `validator.py`、`service.py`、普通/管理员路由、两个 Web 面板、[浏览器插件架构](extension.md)、HTTP 契约和对象存储说明。主要验证入口为 `test_plugin_releases.py`、`modules/plugin_releases/test_service.py`、`test_validator.py`、Web `PluginReleasePanel` 与 `PluginInstallDialog` 测试。
