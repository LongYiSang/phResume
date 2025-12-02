# 后端 API 文档（phResume）

API 基础前缀：`/v1`

- 认证方式：`Authorization: Bearer <access_token>`（RS256 JWT）
- 刷新令牌通过 `HttpOnly` Cookie（名为 `refresh_token`）或请求体字段传递
- 生成 PDF/预览的内部打印接口需 `internal_token` 与环境变量 `INTERNAL_API_SECRET` 一致
- 所有时间字段为 ISO8601 字符串；ID 为整数（除非另有说明）
- 错误响应约定：所有失败响应体统一为 `{ "error": string }`，未授权文案统一为 `unauthorized`

---

**健康与指标**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/health` | 健康检查 | 无 | 匿名处理函数（backend/cmd/api/main.go:111） |
| GET | `/metrics` | Prometheus 指标 | 无 | `gin.WrapH(promhttp.Handler())`（backend/cmd/api/main.go:114） |

响应示例：

- 成功 200（/health）

```json
{ "status": "ok" }
```

---

**认证（Auth）**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| POST | `/v1/auth/register` | 注册账号 | 无 | `AuthHandler.Register`（backend/internal/api/auth_handler.go:48） |
| POST | `/v1/auth/login` | 登录并返回访问令牌，设置刷新令牌 Cookie | 无 | `AuthHandler.Login`（backend/internal/api/auth_handler.go:99） |
| POST | `/v1/auth/refresh` | 使用刷新令牌获取新的访问令牌/刷新令牌 | 无 | `AuthHandler.Refresh`（backend/internal/api/auth_handler.go:150） |
| POST | `/v1/auth/logout` | 注销并吊销刷新令牌 | 需要 | `AuthHandler.Logout`（backend/internal/api/auth_handler.go:213） |

请求与响应：

- `POST /v1/auth/register`
  - 请求 Body 字段：
    - `username`：string，必填，3-64 字符
    - `password`：string，必填，8-72 字符
  - 示例请求：
    ```json
    { "username": "alice", "password": "P@ssw0rd123" }
    ```
  - 响应：
    - 成功 201，无响应体
    - 400 参数错误；409 用户名已存在；500 服务器错误

- `POST /v1/auth/login`
  - 请求 Body 字段：
    - `username`：string，必填
    - `password`：string，必填
  - 示例请求：
    ```json
    { "username": "alice", "password": "P@ssw0rd123" }
    ```
  - 响应：
    - 成功 200：
      ```json
      {
        "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
        "token_type": "Bearer",
        "expires_in": 3600
      }
      ```
      同时设置 `refresh_token` 为 `HttpOnly` Cookie
    - 401 凭证错误；500 服务器错误

- `POST /v1/auth/refresh`
  - 刷新令牌来源：
    - Cookie：`refresh_token`
    - 或 请求体字段：`refresh_token`（string）
  - 示例请求（Body 方式）：
    ```json
    { "refresh_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." }
    ```
  - 响应：
    - 成功 200：与登录响应相同，并旋转刷新令牌（重置 Cookie）
    - 401 刷新令牌缺失/无效/已吊销；500 服务器错误
    - 失败体示例：`{ "error": "unauthorized" }`

- `POST /v1/auth/logout`（需要鉴权）
  - 刷新令牌来源同上（Cookie 或 Body）
  - 响应：
    - 成功 200，清除 `refresh_token` Cookie
    - 400 刷新令牌缺失；401/500 视校验与存储结果
    - 失败体约定：`{ "error": string }`，未授权为 `unauthorized`

---

**简历（Resume）**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/v1/resume` | 列出当前用户全部简历 | 需要 | `ResumeHandler.ListResumes`（backend/internal/api/resume_handler.go:149） |
| GET | `/v1/resume/latest` | 返回最近/活动简历或默认模板 | 需要 | `ResumeHandler.GetLatestResume`（backend/internal/api/resume_handler.go:121） |
| POST | `/v1/resume` | 创建新简历 | 需要 | `ResumeHandler.CreateResume`（backend/internal/api/resume_handler.go:69） |
| GET | `/v1/resume/:id` | 获取指定简历并标记为活动 | 需要 | `ResumeHandler.GetResume`（backend/internal/api/resume_handler.go:180） |
| PUT | `/v1/resume/:id` | 更新指定简历 | 需要 | `ResumeHandler.UpdateResume`（backend/internal/api/resume_handler.go:209） |
| DELETE | `/v1/resume/:id` | 删除指定简历 | 需要 | `ResumeHandler.DeleteResume`（backend/internal/api/resume_handler.go:263） |
| GET | `/v1/resume/:id/download` | 入队 PDF 生成任务 | 需要 | `ResumeHandler.DownloadResume`（backend/internal/api/resume_handler.go:364） |
| GET | `/v1/resume/:id/download-link` | 获取 PDF 预签名下载链接 | 需要 | `ResumeHandler.GetDownloadLink`（backend/internal/api/resume_handler.go:430） |

请求与响应：

- 通用鉴权：`Authorization: Bearer <access_token>`

- `POST /v1/resume`
  - 请求 Body 字段：
    - `title`：string，必填
    - `content`：object(JSON)，必填。结构参见下方示例
    - `preview_image_url`：string，可选
  - 示例请求：
    ```json
    {
      "title": "我的简历",
      "content": {
        "layout_settings": {
          "columns": 24,
          "row_height_px": 10,
          "accent_color": "#3388ff",
          "font_family": "Arial",
          "font_size_pt": 10,
          "margin_px": 30
        },
        "items": [
          {
            "id": "item-1",
            "type": "text",
            "content": "你的名字",
            "style": { "fontSize": "24pt", "fontWeight": "bold" },
            "layout": { "x": 0, "y": 2, "w": 16, "h": 6 }
          }
        ]
      }
    }
    ```
  - 响应：
    - 成功 201：
      ```json
      {
        "id": 123,
        "title": "我的简历",
        "content": { /* 与请求结构一致 */ },
        "preview_image_url": "https://...",
        "created_at": "2025-01-01T12:00:00Z",
        "updated_at": "2025-01-01T12:00:00Z"
      }
      ```
    - 403 达到简历数量上限；400/500 视校验与存储结果
    - 失败体示例：`{ "error": "resume limit reached" }`

- `GET /v1/resume`
  - 响应 200：
    ```json
    [
      { "id": 123, "title": "我的简历", "preview_image_url": "https://...", "created_at": "2025-01-01T12:00:00Z" }
    ]
    ```

- `GET /v1/resume/latest`
  - 响应 200：可能返回默认模板（`id` 为 0，`content` 为系统默认）或最新简历

- `GET /v1/resume/:id` / `PUT /v1/resume/:id`
  - 成功：分别 200（更新）/200（读取），结构同创建成功体
  - 错误：400 ID 非法；404 未找到；500 服务器错误

- `DELETE /v1/resume/:id`
  - 成功 204，无响应体

- `GET /v1/resume/:id/download`
  - 响应：
    - 成功 202：
      ```json
      { "message": "PDF generation request accepted", "task_id": "asynq-task-id" }
      ```
    - 400/404/500 视 ID 与入队结果

- `GET /v1/resume/:id/download-link`
  - 响应：
    - 成功 200：`{ "url": "https://presigned-url" }`
    - 409 PDF 尚未生成；400/404/500 视查询结果
    - 失败体示例：`{ "error": "pdf not ready" }`

---

**资产（Assets）**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/v1/assets` | 列出当前用户上传的资产（按最近修改时间排序） | 需要 | `AssetHandler.ListAssets`（backend/internal/api/asset_handler.go:97） |
| POST | `/v1/assets/upload` | 上传资产（图片等），上传前进行 ClamAV 病毒扫描 | 需要 | `AssetHandler.UploadAsset`（backend/internal/api/asset_handler.go:36） |
| GET | `/v1/assets/view?key=<objectKey>` | 获取资产的临时预签名访问链接 | 需要 | `AssetHandler.GetAssetURL`（backend/internal/api/asset_handler.go:144） |

请求与响应：

- 通用鉴权：`Authorization: Bearer <access_token>`

- `GET /v1/assets?limit=<n>`
  - 查询参数：
    - `limit`：整数，可选，默认 60，最大 200
  - 响应 200：
    ```json
    {
      "items": [
        {
          "objectKey": "user-assets/1/xxxx.png",
          "previewUrl": "https://presigned-url",
          "size": 12345,
          "lastModified": "2025-01-01T12:00:00Z"
        }
      ]
    }
    ```

- `POST /v1/assets/upload`
  - 表单字段：
    - `file`：`multipart/form-data` 文件，必填
  - 响应：
    - 成功 201：`{ "objectKey": "user-assets/<userId>/<uuid>.png" }`
    - 400 缺少文件或检测到恶意文件；500 上传/扫描错误

- `GET /v1/assets/view?key=<objectKey>`
  - 查询参数：
    - `key`：string，必填，且必须以 `user-assets/<userId>/` 前缀开头
  - 响应：
    - 成功 200：`{ "url": "https://presigned-url" }`
    - 400 缺少 key；403 前缀不匹配；500 生成链接失败

---

**模板（Templates）**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/v1/templates` | 列出我的模板 ∪ 所有公开模板 | 需要 | `TemplateHandler.ListTemplates`（backend/internal/api/template_handler.go:155） |
| GET | `/v1/templates/:id` | 获取模板详情（仅 owner 或公开） | 需要 | `TemplateHandler.GetTemplate`（backend/internal/api/template_handler.go:185） |
| POST | `/v1/templates` | 创建私有模板（受数量上限限制） | 需要 | `TemplateHandler.CreateTemplate`（backend/internal/api/template_handler.go:69） |
| POST | `/v1/templates/:id/generate-preview` | 入队模板预览生成任务 | 需要 | `TemplateHandler.GeneratePreview`（backend/internal/api/template_handler.go:225） |
| DELETE | `/v1/templates/:id` | 删除模板（仅 owner） | 需要 | `TemplateHandler.DeleteTemplate`（backend/internal/api/template_handler.go:114） |

请求与响应：

- `POST /v1/templates`
  - 请求 Body 字段：
    - `title`：string，必填
    - `content`：object(JSON)，必填
  - 响应：
    - 成功 201：`{ "id": 456, "title": "我的模板" }`
    - 403 模板数量上限；400/500 视校验与存储结果

- `GET /v1/templates`
  - 响应 200：
    ```json
    [
      { "id": 456, "title": "我的模板", "preview_image_url": "https://...", "is_owner": true }
    ]
    ```

- `GET /v1/templates/:id`
  - 响应 200：
    ```json
    { "id": 456, "title": "我的模板", "content": { /* JSON */ }, "preview_image_url": "https://..." }
    ```
  - 错误：403 非 owner 且非公开；404 未找到；500 服务器错误
  - 失败体示例：`{ "error": "access denied" }`

- `POST /v1/templates/:id/generate-preview`
  - 响应：
    - 成功 202：`{ "message": "template preview generation scheduled", "task_id": "asynq-task-id" }`
    - 403 非 owner；404 未找到；500 入队错误

- `DELETE /v1/templates/:id`
  - 成功 204，无响应体

---

**内部打印数据（Worker 使用）**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/v1/resume/print/:id?internal_token=<secret>` | 返回简历渲染所需 JSON（内联图像预签名） | `internal_token` | `ResumeHandler.GetPrintResumeData`（backend/internal/api/resume_handler.go:465） |
| GET | `/v1/templates/print/:id?internal_token=<secret>` | 返回模板渲染所需 JSON（内联图像预签名） | `internal_token` | `TemplateHandler.GetPrintTemplateData`（backend/internal/api/template_handler.go:275） |

请求与响应：

- 鉴权：查询参数 `internal_token` 必须与环境变量 `INTERNAL_API_SECRET` 完全匹配
- 响应：
  - 成功 200：返回 `resume.Content` 结构：
    ```json
    {
      "layout_settings": { "columns": 24, "row_height_px": 10, "accent_color": "#3388ff", "font_family": "Arial", "font_size_pt": 10, "margin_px": 30 },
      "items": [
        { "id": "item-1", "type": "text", "content": "...", "style": { }, "layout": { "x": 0, "y": 2, "w": 16, "h": 6 } }
      ]
    }
    ```
  - 401 内部令牌缺失/不匹配；400 ID 非法；404 未找到；500 服务器错误
  - 失败体示例：`{ "error": "unauthorized" }`

---

**WebSocket 推送**

| 方法 | 路径 | 描述 | 鉴权 | 调用的方法 |
| - | - | - | - | - |
| GET | `/v1/ws` | 建立 WebSocket 连接并订阅用户通知 | 首条消息携带 JWT | `WsHandler.HandleConnection`（backend/internal/api/ws_handler.go:47） |

连接协议：

- 握手成功后，客户端必须发送认证消息：
  ```json
  { "type": "auth", "token": "<access_token>" }
  ```
- 令牌校验通过后，服务端订阅 Redis 渠道 `user_notify:<user_id>` 并转发文本消息给客户端
- 令牌无效或缺失时，连接将被关闭

消息示例（由 Worker 发布，原样透传）：

```json
{ "event": "pdf_ready", "resume_id": 123, "url": "https://presigned-url" }
```

---

更新说明：本文件与后端代码实现同步维护；如接口发生变更（路径、鉴权、字段或响应），请立即更新本表。
