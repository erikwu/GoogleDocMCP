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
- `google_doc_write`
- `google_sheet_read`
- `google_slide_read`
- `google_slide_write`
- `google_slide_apply_sheet_mappings`
- `obsidian_note_write`
- `obsidian_sync_google_doc`
- `obsidian_sync_google_doc_ssot`

## License

Apache License 2.0. See [LICENSE](LICENSE).

## 当前认证方式

默认支持本地 credential 文件：

- `service_account`
- `access_token`

如果使用 `service_account`，需要把目标 Google Doc / Google Sheet / Google Slide 分享给该服务账号邮箱。

## 如何获得 `google-service-account.json`

当前项目默认推荐用 `service_account` 做最小闭环，因为它最适合“本地放一个 credential 文件，然后 MCP 直接调用 Google Docs API”这种工作方式。

### 1. 准备一个 Google Cloud Project

1. 打开 Google Cloud Console。
2. 新建一个项目，或者选中你已有的项目。
3. 后续所有 API、Service Account 和 key 都会绑定在这个项目下。

### 2. 启用 Google Docs API / Google Sheets API / Google Slides API

1. 在当前项目里启用 Google Docs API。
2. 如果你要使用当前已经支持的 Google Sheet 读取，也要启用 Google Sheets API。
3. 如果你要使用当前已经支持的 Google Slide 读取和写入，也要启用 Google Slides API。
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

后面你需要把目标 Google Doc / Google Sheet / Google Slide 分享给这个邮箱。

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
4. 如果只是读取，至少给 `Viewer` 权限；如果要支持 `Obsidian -> Google Doc` 覆盖写回，需要给 `Editor` 权限。

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

如果你要读取 Google Sheet，并支持 Google Doc / Google Slide 写入，`scopes` 至少要包含：

```json
[
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations"
]
```

### 5. 重启 Codex

改完 `~/.codex/config.toml` 后，建议直接重启 Codex App。

这样最稳妥，因为新加的 MCP server 一般需要在 Codex 重新启动后才会被完整加载。

### 6. 验证是否接入成功

重启后，你就可以在 Codex 里尝试调用这个 MCP 提供的工具，例如：

- `google_doc_read`
- `google_doc_write`
- `google_sheet_read`
- `google_slide_read`
- `google_slide_write`
- `google_slide_apply_sheet_mappings`
- `obsidian_note_write`
- `obsidian_sync_google_doc`
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

## Google Doc 读取与写入

`google_doc_read` 会返回：

- `title`
- `markdown`
- `plainText`
- `tabs`

`google_doc_write` 会用传入的 markdown 或 text 覆盖 Google Doc 正文。

当前写入侧会优先保留这些结构：

- Markdown 标题
- 普通段落
- 无序列表
- 有序列表
- 引用块
- 代码块
- 粗体、斜体、删除线
- 行内代码
- Markdown 链接
- Markdown 表格会退化成可读文本行

当前不做复杂结构保真：

- Google Doc tabs 写回
- 更复杂的嵌套 markdown 组合样式
- 真正的 Google Doc 表格重建

示例：

```json
{
  "source": {
    "url": "https://docs.google.com/document/d/your-doc-id/edit"
  },
  "markdown": "# Weekly Update\n\n- Item A\n- Item B"
}
```

## Google Slide 读取与写入

`google_slide_read` 会返回：

- presentation 标题
- `revisionId`
- 每一页的 `slideNumber`
- 每一页的 `objectId`
- slide 内文本归一化后的 `markdown`
- slide 内 page element 的结构化信息

`google_slide_write` 当前支持三种最小写法：

- `replace_all_text`
  适合按占位符批量替换文本，可选限定到某一页
- `replace_shape_text`
  适合按 shape 的 `object_id` 精准替换某一个文本框的全部内容
- `replace_table_cell_text`
  适合按 table 的 `object_id` 精准替换某个单元格的全部内容，`row_index` / `column_index` 使用 0-based 索引

示例：

```json
{
  "source": {
    "url": "https://docs.google.com/presentation/d/your-slide-id/edit"
  }
}
```

```json
{
  "source": {
    "id": "your-slide-id"
  },
  "operations": [
    {
      "mode": "replace_all_text",
      "match_text": "{{owner}}",
      "replace_text": "Erik",
      "slide_number": 2
    },
    {
      "mode": "replace_shape_text",
      "object_id": "g2b7c9d1e0f_0_12",
      "text": "Updated content from MCP"
    },
    {
      "mode": "replace_table_cell_text",
      "object_id": "g3f23f6f4d08_0_3",
      "row_index": 1,
      "column_index": 3,
      "text": "4/22"
    }
  ]
}
```

## Google Sheet 驱动 Google Slide 更新

`google_slide_apply_sheet_mappings` 会先读取 Google Sheet，再把表格里的映射规则应用到 Google Slide。

默认推荐的最小表头：

```text
mode | placeholder | value | slide | object_id | text | enabled
```

使用规则：

- `mode = replace_all_text`
  需要 `placeholder` 和 `value`
- `mode = replace_shape_text`
  需要 `object_id` 和 `text`
- `slide`
  可填 slide number，例如 `2`；也可直接填 slide 的 `objectId`
- `enabled`
  可填 `true/false`

示例：

```json
{
  "presentation": {
    "url": "https://docs.google.com/presentation/d/your-slide-id/edit"
  },
  "sheet": {
    "url": "https://docs.google.com/spreadsheets/d/your-sheet-id/edit#gid=0",
    "sheet": "Mappings",
    "range": "A1:G20"
  }
}
```

这个工具适合做两类事情：

- 用 Sheet 统一管理 Slide 占位符替换
- 用 Sheet 精准指定某个文本框 `object_id` 的最终内容

## 启动

```bash
node src/index.js
```

## 两套同步模板

### 模板 1：Obsidian md 为主，Google Doc 为辅

当你调用 `obsidian_sync_google_doc` 时，会读取 marker 内的 markdown 内容，并直接覆盖 Google Doc 正文。

示例见：

- [examples/obsidian-primary-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/obsidian-primary-sync.example.md)

模板写法：

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: obsidian_to_google_doc
google_doc_sync_heading: "## Obsidian Primary Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# 我的笔记

这里是 Obsidian 自有内容，不参与同步。

## Obsidian Primary Sync

<!-- google-doc-sync:start -->
# 这一段以 Obsidian 为准

这里的内容会覆盖 Google Doc 正文。
<!-- google-doc-sync:end -->
```

### 模板 2：Google Doc 为主，Obsidian md 为辅

当你调用 `obsidian_sync_google_doc` 时，会读取 Google Doc 最新内容，只更新 marker 内的区块，保留 Obsidian 其他人工内容。

示例见：

- [examples/google-doc-primary-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/google-doc-primary-sync.example.md)

模板写法：

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: google_doc_to_obsidian
google_doc_sync_heading: "## Google Doc Primary Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# 我的笔记

这里是 Obsidian 自有内容，不会被覆盖。

## Google Doc Primary Sync

<!-- google-doc-sync:start -->
<!-- google-doc-sync:end -->
```

### 模板 3：只比较，不改任一边文档

当你调用 `obsidian_sync_google_doc` 且方向为 `compare_only` 时，MCP 会读取 Google Doc 与 Obsidian marker 区块内容，输出差异总结，但不会修改 Google Doc，也不会修改 Obsidian note。

示例见：

- [examples/compare-only-sync.example.md](/Users/erik/Documents/GoogleDoc%20MCP/examples/compare-only-sync.example.md)

模板写法：

```md
---
google_doc_sync_url: https://docs.google.com/document/d/your-doc-id/edit
google_doc_sync_direction: compare_only
google_doc_sync_heading: "## Compare Only Sync"
google_doc_sync_start_marker: "<!-- google-doc-sync:start -->"
google_doc_sync_end_marker: "<!-- google-doc-sync:end -->"
---

# 我的笔记

这里是 Obsidian 自有内容，不参与比较结果写回。

## Compare Only Sync

<!-- google-doc-sync:start -->
# 当前 Obsidian 区块

只做差异比较，不做同步覆盖。
<!-- google-doc-sync:end -->
```

返回结果会包含：

- `comparison.exactMatch`：两边是否完全一致
- `comparison.comparisonStatus`：`match`、`different` 或 `managed-block-missing`
- `comparison.hunks`：差异分段预览，便于后续人工判断要不要同步
- `modifiedTargets: []`：明确表示这次没有改动任何目标

### 调用方式

推荐直接调用：

```json
{
  "note_path": "/absolute/path/to/your-note.md"
}
```

工具会自动读取 note frontmatter 里的：

- `google_doc_sync_url`
- `google_doc_sync_direction`
- `google_doc_sync_start_marker`
- `google_doc_sync_end_marker`
- `google_doc_sync_heading`

如果你想临时覆盖方向，也可以显式传：

```json
{
  "note_path": "/absolute/path/to/your-note.md",
  "direction": "obsidian_to_google_doc"
}
```

比较模式也可以这样显式调用：

```json
{
  "note_path": "/absolute/path/to/your-note.md",
  "direction": "compare_only"
}
```

## 旧版 SSOT 模板

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

`obsidian_sync_google_doc_ssot` 现在是兼容旧调用的别名：

- 如果 note 没配置方向，默认按 `Google Doc -> Obsidian`
- 如果 note 明确配置了 `google_doc_sync_direction: obsidian_to_google_doc`，也会按该方向执行，不再强制覆盖成 `Google Doc -> Obsidian`

- note 其他内容保持不变
- 如果没有同步区块，会自动在文末追加
- 如果检测到这次更新只是 Doc 尾部新增内容，会在返回结果里标记为 `append-only`

`obsidian_sync_google_doc` 是更通用的新入口：

- 当 `google_doc_sync_direction = google_doc_to_obsidian` 时，行为类似旧版 `obsidian_sync_google_doc_ssot`
- 当 `google_doc_sync_direction = obsidian_to_google_doc` 时，会把 marker 区块内容覆盖写回 Google Doc
- 当 `google_doc_sync_direction = compare_only` 时，只返回 Google Doc 与 Obsidian marker 区块的差异总结，不修改任一边文档

当前 MCP 不做后台文件监听。

- “修改后直接同步”指的是调用 MCP 工具时立即按模板方向同步
- 不会在你编辑 note 或 Google Doc 的瞬间自动后台触发
