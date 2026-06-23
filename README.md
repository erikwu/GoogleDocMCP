# Google Workspace MCP

English version: [README.en.md](README.en.md)

文档同步约定：
以后修改本 README 中文内容时，请同时同步更新 `README.en.md`，保持两份文档结构和关键信息一致。

一个最小可运行的 MCP 项目骨架，先打通这条闭环：

1. 从 Obsidian note 中识别 Google Doc SSOT 链接
2. 调用 Google Docs API 读取正文
3. 将同步内容写回 note 的专用同步区块
4. 保留 note 自有内容，不覆盖人工内容

## 当前已实现

- `google_doc_read`
- `google_sheet_read`
- `obsidian_note_write`
- `obsidian_sync_google_doc_ssot`

## License

Apache License 2.0. See [LICENSE](LICENSE).

## 当前认证方式

默认支持本地 credential 文件：

- `service_account`
- `access_token`

如果使用 `service_account`，需要把目标 Google Doc / Google Sheet 分享给该服务账号邮箱。

## 如何获得 `google-service-account.json`

当前项目默认推荐用 `service_account` 做最小闭环，因为它最适合“本地放一个 credential 文件，然后 MCP 直接调用 Google Docs API”这种工作方式。

### 1. 准备一个 Google Cloud Project

1. 打开 Google Cloud Console。
2. 新建一个项目，或者选中你已有的项目。
3. 后续所有 API、Service Account 和 key 都会绑定在这个项目下。

### 2. 启用 Google Docs API / Google Sheets API

1. 在当前项目里启用 Google Docs API。
2. 如果你要使用当前已经支持的 Google Sheet 读取，也要启用 Google Sheets API。
3. 如果你后面要继续接 Google Slide，也建议顺手启用 Google Slides API。
4. 如果你在创建 key 时遇到 IAM 相关页面不可用，也可以顺手确认 IAM API 是否已启用。

### 3. 创建 Service Account

1. 进入 `IAM & Admin` -> `Service Accounts`。
2. 点击 `Create service account`。
3. 填写：
   - `Service account name`
   - 可选的 `Description`
4. 点击 `Done`，或者按需继续给它分配项目级角色。

创建完成后，Google 会给这个 service account 分配一个邮箱，格式通常像：

```text
your-service-account-name@your-project-id.iam.gserviceaccount.com
```

后面你需要把目标 Google Doc 分享给这个邮箱。

### 3.1 在创建 Service Account 时，Permissions 该怎么选

Google Cloud 的创建向导里，`Grant this service account access to project` 这一步本身就是可选的。对我们这个项目当前的最小闭环来说，我建议这样选：

#### 推荐选择

- `Grant this service account access to project`:
  不选任何角色，直接继续
- `Service account users role field`:
  不填
- `Service account admins role field`:
  不填

#### 为什么这样选

这个 MCP 当前只是：

- 用 Google Docs API 读取指定 Google Doc
- 然后把内容同步到 Obsidian note

这类访问更适合靠两件事来控制：

- 项目里启用 Google Docs API
- 把具体 Google Doc 共享给 service account 邮箱

而不是一上来就给这个 service account 宽泛的项目级 IAM 角色。

#### 什么时候才需要在这里选角色

只有当你明确希望这个 service account 去访问你项目里的其他 Google Cloud 资源时，才需要在这一步给它加项目级 IAM 角色。比如它将来要访问 GCS、BigQuery、Cloud Run 之类的资源。

对于当前这个项目：

- 只读 Google Doc：
  不需要在这里给项目角色
- 未来要改写 Google Doc：
  仍然通常不需要在这里给项目角色；更重要的是把目标 Google Doc 共享给这个 service account，并在本项目配置中把 scope 从只读切到可编辑

#### 你作为操作者自己需要的权限

这里要区分两类权限：

- “service account 自己拥有什么权限”
- “你有没有权限创建它、给它生成 key”

如果你是创建者，Google 官方列出的常见前置权限是：

- 创建 service account：
  `Create Service Accounts` / `roles/iam.serviceAccountCreator`
- 如果你想在创建时顺手给它项目角色：
  `Project IAM Admin` / `roles/resourcemanager.projectIamAdmin`
- 创建 service account key：
  `Service Account Key Admin` / `roles/iam.serviceAccountKeyAdmin`
- 启用 API：
  `Service Usage Admin` / `roles/serviceusage.serviceUsageAdmin`

如果公司策略禁止创建 service account key，你可能即使能创建 service account，也看不到 `Create new key`，这时需要管理员额外放开组织策略。

### 4. 生成 JSON key 并下载

1. 仍然在 `Service Accounts` 页面里，点击你刚创建的 service account。
2. 打开 `Keys` 标签页。
3. 点击 `Add key` -> `Create new key`。
4. 选择 `JSON`。
5. 点击 `Create`。
6. 浏览器会下载一个 JSON 文件，这个文件就是我们要的 service account credential。

建议把下载下来的文件重命名为：

```text
google-service-account.json
```

然后放到仓库根目录下的：

```text
secrets/google-service-account.json
```

这样就能直接匹配当前默认配置。

### 5. 配置到本项目

确认 [config/local.json](config/local.json) 里这段路径是对的：

```json
{
  "google": {
    "auth": {
      "mode": "service_account",
      "credentialPath": "../secrets/google-service-account.json"
    }
  }
}
```

如果你把文件放在别的位置，改 `credentialPath` 就可以。

### 6. 把目标 Google Doc 分享给 Service Account

这一步很关键。

因为这个 MCP 之后是以 service account 身份访问 Google Docs API，所以如果目标文档本来不属于这个 service account，就需要把文档共享给它。

操作方式和给普通邮箱共享文档一样：

1. 打开你的 Google Doc。
2. 点击右上角 `Share`。
3. 把 service account 的邮箱加进去。
4. 至少给 `Viewer` 权限；如果后面要做写回，再给更高权限。

如果不做这一步，最常见结果就是调用 API 时返回 `403 PERMISSION_DENIED`。

### 7. 安全注意事项

- 这个 JSON key 下载后不能再次下载，所以建议立即备份到安全位置。
- 不要把 `google-service-account.json` 提交到 git。
- 不要把这个文件发到聊天工具、邮件或公共网盘。
- 如果你怀疑 key 泄漏，应该在 Google Cloud Console 里删除旧 key，然后重新创建一个新 key。

### 8. 常见问题

#### 看不到 `Create new key`

通常是以下几种原因：

- 你没有足够的 Google Cloud 权限
- 当前组织策略禁止创建 service account key
- 你点开的不是具体 service account，而是列表页

先确认自己能进入该 service account 的 `Keys` 标签页。如果公司策略禁了 key，需要管理员放开，或者后面改成别的认证方案。

#### 已经有 key，但读 Google Doc 还是报 `403`

优先检查：

- 目标 Google Doc 有没有共享给 service account 邮箱
- Google Docs API 是否已启用
- 当前项目和你创建 key 的项目是否一致

#### 报 `404`

通常检查：

- Google Doc 链接是否正确
- 文档 ID 是否解析错了
- 当前 service account 是否真的有权访问这个文档

### 9. 官方文档

- Create service accounts: https://cloud.google.com/iam/docs/service-accounts-create
- Create and delete service account keys: https://cloud.google.com/iam/docs/keys-create-delete
- Google Docs API quickstart: https://developers.google.com/workspace/docs/api/quickstart/nodejs

## 配置

直接编辑 [config/local.json](config/local.json)，或者参考 [config/config.example.json](config/config.example.json)：

- Google 凭据路径
- Obsidian vault 根目录

默认凭据路径指向仓库根目录下的 `secrets/google-service-account.json`。

## 如何把 `google_workspace` MCP 加到 `~/.codex/config.toml`

如果你希望在 Codex 里直接把这个项目作为一个可调用的 MCP 使用，可以把它注册到全局 Codex 配置文件 `~/.codex/config.toml`。

### 1. 打开全局 Codex 配置

找到这个文件：

```text
~/.codex/config.toml
```

如果文件已经存在，就在里面追加一个新的 `mcp_servers.google_workspace` 配置块。

### 2. 加入下面这段配置

把下面内容加入 `~/.codex/config.toml`：

```toml
[mcp_servers.google_workspace]
command = "/opt/homebrew/bin/node"
args = ["/absolute/path/to/GoogleDoc MCP/src/index.js"]
startup_timeout_sec = 30.0
tool_timeout_sec = 120.0

[mcp_servers.google_workspace.env]
GOOGLE_WORKSPACE_MCP_CONFIG = "/absolute/path/to/GoogleDoc MCP/config/local.json"
```

### 3. 按你的本机环境检查路径

上面这段配置里的 `/absolute/path/to/GoogleDoc MCP` 只是占位符。

请替换成你本机上这个项目的真实绝对路径，例如：

```text
/Users/erik/Documents/GoogleDoc MCP
```

请确认这几个路径在你机器上都成立：

- `command` 指向你本机可用的 Node 可执行文件
- `args` 指向这个项目的 [src/index.js](src/index.js)
- `GOOGLE_WORKSPACE_MCP_CONFIG` 指向这个项目的 [config/local.json](config/local.json)

如果你的 Node 不在 `/opt/homebrew/bin/node`，可以先在终端里用 `which node` 找到真实路径，再替换掉这里的值。

### 4. 确认 `config/local.json` 已经可用

这个 MCP 启动时会读取：

```text
/absolute/path/to/GoogleDoc MCP/config/local.json
```

你需要确保里面至少配置好了：

- Google 认证方式
- `credentialPath`
- `scopes`
- Obsidian vault 根目录

如果你使用 `service_account`，也要确认 `credentialPath` 对应的 JSON key 文件已经放好。

如果你要读取 Google Sheet，`scopes` 至少要包含：

```json
[
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
]
```

### 5. 重启 Codex

改完 `~/.codex/config.toml` 后，建议直接重启 Codex App。

这样最稳妥，因为新加的 MCP server 一般需要在 Codex 重新启动后才会被完整加载。

### 6. 验证是否接入成功

重启后，你就可以在 Codex 里尝试调用这个 MCP 提供的工具，例如：

- `google_doc_read`
- `google_sheet_read`
- `obsidian_note_write`
- `obsidian_sync_google_doc_ssot`

如果工具能被识别，说明 `google_workspace` MCP 已经接入成功。

### 8. 仓库里的本地文件说明

下面这些文件或目录默认不会提交到 git：

- `secrets/`
- `config/local.json`
- `.codex/`
- `.learnings/`

这样做是为了避免把 service account key、本机调试配置和私有运行痕迹一起推到远端仓库。

### 7. 常见问题

#### 配置改了，但 Codex 里还是看不到工具

优先检查：

- `~/.codex/config.toml` 里的 TOML 语法是否正确
- `command` 的 Node 路径是否真实存在
- `args` 里的 `src/index.js` 路径是否正确
- `GOOGLE_WORKSPACE_MCP_CONFIG` 指向的 `local.json` 是否存在
- Codex 是否已经完全退出并重新打开

#### MCP 启动了，但调用 Google API 失败

优先检查：

- `credentialPath` 是否正确
- service account key 是否有效
- 目标 Google Doc 是否已经共享给 service account 邮箱
- Google Docs API / Sheets API / Slides API 是否已经在对应 GCP 项目中启用

## Google Sheet 读取

`google_sheet_read` 支持这几种最小输入方式：

- 直接传 Google Sheet URL
- 传 spreadsheet id
- 结合 `sheet` 指定页签名
- 结合 `gid` 指定页签 id
- 结合 `range` 指定 A1 区间

示例：

```json
{
  "source": {
    "url": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit#gid=0"
  }
}
```

```json
{
  "source": {
    "id": "your-sheet-id",
    "sheet": "Sheet1",
    "range": "A1:F20"
  }
}
```

返回结果里会包含：

- `title`
- `sheetTitle`
- `sheetId`
- `requestedRange`
- `markdown`
- `plainText`
- `rows`
- `availableSheets`

## 启动

```bash
node src/index.js
```

## 建议的 Obsidian note 写法

```md
---
google_doc_ssot_url: https://docs.google.com/document/d/your-doc-id/edit
---

# 我的笔记

这里是我自己维护的内容，不会在同步时被覆盖。

## Google Doc SSOT Sync

<!-- google-doc-ssot:start -->
<!-- google-doc-ssot:end -->
```

## 同步行为

`obsidian_sync_google_doc_ssot` 只会更新 `<!-- google-doc-ssot:start -->` 和 `<!-- google-doc-ssot:end -->` 之间的内容。

- note 其他内容保持不变
- 如果没有同步区块，会自动在文末追加
- 如果检测到这次更新只是 Doc 尾部新增内容，会在返回结果里标记为 `append-only`
