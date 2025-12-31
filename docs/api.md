<!--
说明：
- 本文档包含：
  1) 对外 HTTP API（/v1）与 WebSocket 协议
  2) Worker/任务协议（Asynq payload、Redis 通知）
  3) Go 后端导出的结构体/函数/方法（exported identifiers）
- 
-->

# API 文档

## 1. 版本与约定

- API 版本前缀：`/v1`
- 返回错误统一结构（多数场景）：`{"error":"..."}`
- `Content-Type`：JSON 接口使用 `application/json`
- 认证：
  - 业务接口（除 `/v1/auth/*`、`/health`、`/metrics`、内部接口外）需要 `Authorization: Bearer <access_token>`
  - 刷新令牌默认通过 `HttpOnly` Cookie：`refresh_token`
- 追踪：
  - 请求头 `X-Correlation-ID`：可由客户端传入；未传入时由服务端生成并回写到响应头
- 内部接口：
  - Worker 访问内部打印数据接口必须使用 `X-Internal-Secret: <INTERNAL_API_SECRET>`

## 2. HTTP API（Gin，`/v1`）

### 2.1 Health / Metrics

#### GET `/health`
- 认证：否
- 响应：`200 {"status":"ok"}`

#### GET `/metrics`
- 认证：否（注意：生产 Nginx 默认拦截对外访问 `/api/metrics`）
- 响应：Prometheus 文本格式

### 2.2 Auth（`/v1/auth`）

#### POST `/v1/auth/register`
创建新用户。
- 请求体：
  - `username` string：必填，长度 `3..64`
  - `password` string：必填，长度 `8..72`
- 响应：
  - `201`：无 body
  - `409 {"error":"username already taken"}`

#### POST `/v1/auth/login`
登录并颁发 TokenPair。
- 请求体：
  - `username` string：必填
  - `password` string：必填
- 逻辑要点：
  - 登录频控：按 `IP + username + hour` 计数（超限返回 429）
  - 登录锁定：按用户名连续失败计数，达到阈值后锁定一段时间（返回 429）
- 响应（成功 `200`）：
  - `access_token` string：访问令牌（JWT，RS256）
  - `token_type` string：固定 `"Bearer"`
  - `expires_in` number：access token 秒级过期时间
  - `must_change_password` boolean：是否强制改密（例如通过 `cmd/admin` 创建的初始账号）
  - 同时设置 `Set-Cookie: refresh_token=<refresh_token>; HttpOnly; SameSite=Lax; ...`
- 失败：
  - `401 {"error":"unauthorized"}`
  - `429 {"error":"rate limit exceeded"}` 或 `{"error":"account temporarily locked"}`

#### POST `/v1/auth/refresh`
使用 refresh token 换取新的 TokenPair，并旋转旧 refresh token（黑名单）。
- refresh token 来源（优先级）：
  1) Cookie：`refresh_token`
  2) JSON body：`{"refresh_token":"..."}`（可选）
- 响应（成功 `200`）：同登录响应结构，同时刷新 Cookie
- 失败：
  - `401 {"error":"unauthorized"}`

#### POST `/v1/auth/logout`
将 refresh token 加入黑名单并清除 Cookie。
- 认证：需要 `Authorization: Bearer ...`
- 响应：`200`（同时清除 `refresh_token` Cookie）
- 失败：
  - `400 {"error":"refresh token missing"}`
  - `401 {"error":"unauthorized"}`

#### POST `/v1/auth/change-password`
改密并解除强制改密状态。
- 认证：需要 `Authorization: Bearer ...`
- 请求体：
  - `current_password` string：必填，`8..72`
  - `new_password` string：必填，`8..72`，且必须与 `current_password` 不同
  - `confirm_password` string：必填，必须与 `new_password` 相同
- 响应（成功 `200`）：同登录响应结构，同时刷新 Cookie
- 失败：
  - `400 {"error":"..."}`：参数校验失败/确认密码不匹配/新旧相同等
  - `401 {"error":"unauthorized"}`

### 2.3 Resume（`/v1/resume`）

#### GET `/v1/resume`
列出当前用户全部简历。
- 认证：需要 Bearer；且必须已完成改密（`RequirePasswordChangeCompletedMiddleware`）
- 响应：`200` 数组
  - `id` number
  - `title` string
  - `preview_image_url` string（可选）
  - `created_at` string（RFC3339）

#### GET `/v1/resume/latest`
返回“当前活跃/最近编辑”的简历；若没有任何简历则返回默认模板（`id=0`）。
- 认证：同上
- 响应：`200`
  - `id` number
  - `title` string
  - `content` object：布局数据（见“打印数据/简历内容结构”）
  - `preview_image_url` string（可选）
  - `created_at` / `updated_at` string

#### POST `/v1/resume`
创建简历。
- 认证：同上
- 请求体：
  - `title` string：必填
  - `content` object：必填（JSONB 存储）
  - `preview_image_url` string：可选
- 限额：
  - 超过 `API_MAX_RESUMES` 返回 `403 {"error":"resume limit reached"}`
- 响应：`201`，返回简历详情（同 GET `/v1/resume/:id`）

#### GET `/v1/resume/:id`
获取指定简历并标记为“当前活跃简历”。
- 认证：同上
- 响应：`200`（简历详情）

#### PUT `/v1/resume/:id`
覆盖更新简历。
- 认证：同上
- 请求体：同创建
- 响应：`200`（更新后的简历详情）

#### DELETE `/v1/resume/:id`
删除简历，同时尝试将用户的 `active_resume_id` 回落到最近一份。
- 认证：同上
- 响应：`204`

#### GET `/v1/resume/:id/download`
触发异步 PDF 生成（入队 Asynq），立即返回 202。
- 认证：同上
- 频控：
  - `API_PDF_RATE_LIMIT_PER_HOUR`：按 `user_id + hour` 计数
- 响应：`202`
  - `message` string：`"PDF generation request accepted"`
  - `task_id` string：Asynq task id
  - `resume_id` number
  - `correlation_id` string：用于前端过滤 WS 通知
- 失败：`429 {"error":"rate limit exceeded"}`

#### GET `/v1/resume/:id/download-link`
当 PDF 已生成后，签发一次性下载 Token（短 TTL），用于无鉴权下载代理接口。
- 认证：同上
- 前置条件：`resume.pdf_url` 非空，否则 `409 {"error":"pdf not ready"}`
- 响应：`200`
  - `token` string：一次性下载 Token
  - `uid` number：用户 ID（用于构造下载链接的参数）
  - `expires_in` number：秒级 TTL（由 `API_PDF_DOWNLOAD_TOKEN_TTL` 控制）

#### GET `/v1/resume/:id/download-file?uid=...&token=...&download=1&filename=...`
通过一次性 Token 校验后，代理/流式返回 PDF 文件内容。
- 认证：否（不依赖 Authorization Header）
- Query：
  - `uid` number：用户 ID
  - `token` string：一次性 Token
  - `download` string：可选，用于浏览器语义（当前服务端不依赖该值）
  - `filename` string：可选，下载文件名；服务端会做基础清洗并强制 `.pdf`
- 响应：
  - `200 application/pdf`：`Content-Disposition: attachment; filename="..."`
  - `404 {"error":"download link expired"}`：Token 过期/已使用/参数不合法/PDF 不存在等

### 2.4 Assets（`/v1/assets`）

#### GET `/v1/assets?limit=60`
列出用户资产（图片）与统计信息。
- 认证：需要 Bearer；且必须已完成改密
- Query：
  - `limit` number：默认 `60`，最大 `200`
- 响应：`200`
  - `items` array：
    - `objectKey` string：对象键（如 `user-assets/<uid>/<uuid>.png`）
    - `previewUrl` string：预签名 URL（默认 10 分钟）
    - `size` number：字节
    - `lastModified` string：创建时间
  - `stats` object：
    - `assetCount` number
    - `maxAssets` number：`API_MAX_ASSETS_PER_USER`
    - `todayUploads` number：当天上传次数
    - `maxUploadsPerDay` number：`API_MAX_UPLOADS_PER_DAY`

#### POST `/v1/assets/upload`
上传图片，上传前会通过 ClamAV 扫描。
- 认证：同上
- Content-Type：`multipart/form-data`
- Form field：
  - `file`：必填
- 限制：
  - 数量上限：`API_MAX_ASSETS_PER_USER`（超限 `403 {"error":"asset limit reached"}`）
  - 每日上传次数：`API_MAX_UPLOADS_PER_DAY`（超限 `429 {"error":"rate limit exceeded"}`）
  - 最大体积：`API_UPLOAD_MAX_BYTES`（超限 `413 {"error":"payload too large"}`）
  - MIME 白名单：`API_UPLOAD_MIME_WHITELIST`（默认 PNG/JPEG/WebP；不匹配 `400 {"error":"unsupported media type"}`）
- 响应：`201 {"objectKey":"..."}`

#### GET `/v1/assets/view?key=...`
返回某个资产的预签名访问 URL。
- 认证：同上
- Query：
  - `key` string：对象键，必须属于当前用户且存在于 DB
- 响应：`200 {"url":"https://..."}`（默认 15 分钟）

#### DELETE `/v1/assets?key=...`
删除资产：先删对象存储，再删 DB 记录。
- 认证：同上
- 响应：`200 {"message":"asset deleted"}`

### 2.5 Templates（`/v1/templates`）

#### GET `/v1/templates`
列出模板：当前用户私有模板 ∪ 所有公开模板（当前创建默认私有）。
- 认证：需要 Bearer；且必须已完成改密
- 响应：`200` 数组：
  - `id` number
  - `title` string
  - `preview_image_url` string（可选）
  - `is_owner` boolean：是否为当前用户创建

#### POST `/v1/templates`
创建模板（默认私有）。
- 认证：同上
- 请求体：
  - `title` string：必填
  - `content` object：必填
- 限额：`API_MAX_TEMPLATES`
- 响应：`201 {"id":<number>,"title":"..."}`

#### GET `/v1/templates/:id`
获取模板详情：Owner 可访问；公开模板允许任意已登录用户访问。
- 认证：同上
- 响应：`200`
  - `id` number
  - `title` string
  - `content` object
  - `preview_image_url` string（可选）

#### DELETE `/v1/templates/:id`
删除模板：仅 Owner 可删除（且仅删除私有模板记录本身；公开模板策略可扩展）。
- 认证：同上
- 响应：`204`

#### POST `/v1/templates/:id/generate-preview`
触发模板缩略图生成任务（Asynq）。
- 认证：同上
- 响应：`202 {"message":"template preview generation scheduled","task_id":"..."}`

## 3. 内部打印数据接口（仅 Worker）

> 这些接口会返回打印页渲染所需 JSON（并将图片资源内联为 data URI）。生产 Nginx 会对外拦截对应路径，防止泄露。

### GET `/v1/resume/print/:id`
- 鉴权：`X-Internal-Secret: <INTERNAL_API_SECRET>`
- 响应：`200` 打印数据（见下）

### GET `/v1/templates/print/:id`
- 鉴权：同上
- 响应：`200` 打印数据（见下）

### 打印数据/简历内容结构（`PrintData` / `ResumeData`）

#### 顶层字段
- `layout_settings` object：布局设置（例如 `columns`, `row_height_px`, `margin_px` 等）
- `items` array：元素列表（text / section_title / divider / image）
- `warnings` array（可选）：告警信息（例如资源缺失但允许继续生成）

#### items 元素（概览）
- `id` string：元素 id
- `type` string：`text` / `section_title` / `divider` / `image` / ...
- `content` string：
  - 对 `text/section_title/divider`：文本/HTML 内容（最终在打印页渲染）
  - 对 `image`：在内部打印接口中会被替换为 `data:<mime>;base64,...`（若资源缺失会被跳过并产生 warning）
- `layout` object：网格布局（`x,y,w,h`）
- `style` object：样式（颜色、字号、背景透明度等）

#### warnings 告警（`PrintWarning`）
- `code` number：
  - `4004`：资源缺失（`errcode.ResourceMissing`）
- `message` string
- `missing_keys` array：缺失/无效的对象键列表（去重）

## 4. WebSocket（`/v1/ws`）

### 4.1 建连
- 入口：`GET /v1/ws`（升级为 WebSocket）
- Origin 校验：
  - `API_ALLOWED_ORIGINS` 为空：仅允许同源（Origin host 与请求 Host 一致）
  - 非空：仅允许白名单中的 Origin

### 4.2 鉴权消息（客户端 -> 服务端）
客户端连接建立后必须先发送一次鉴权消息，否则连接会被关闭：
```json
{ "type": "auth", "token": "<access_token>" }
```
约束：
- token 必须是 `token_type=access` 的 JWT
- 若 token 的 `must_change_password=true`，服务端拒绝并关闭连接

### 4.3 服务端推送（服务端 -> 客户端）
服务端会订阅 Redis Pub/Sub 频道：`user_notify:<user_id>`，并将消息 payload 原样转发给 WebSocket 客户端。

#### PDF 生成通知（`PDFGenerationNotifyMessage`）
```json
{
  "status": "completed",
  "resume_id": 123,
  "correlation_id": "uuid",
  "error_code": 0,
  "error_message": "",
  "missing_keys": []
}
```
- `status` string：`completed` / `error`
- `resume_id` number：简历 ID
- `correlation_id` string：请求侧 correlation id（用于前端过滤本次生成任务）
- `error_code` number：见 `errcode`（0/4004/5000）
- `error_message` string：错误说明（`status=error` 时必然有意义）
- `missing_keys` array（可选）：当 `error_code=4004` 时附带缺失资源

## 5. 异步任务协议（Asynq）

### 5.1 任务类型常量（`internal/tasks`）
- `TypePDFGenerate = "pdf:generate"`
- `TypeTemplatePreview = "template:generate_preview"`

### 5.2 Payload
#### `PDFGeneratePayload`
- `resume_id` number：目标简历 ID
- `correlation_id` string：关联请求 ID

#### `TemplatePreviewPayload`
- `template_id` number：目标模板 ID
- `correlation_id` string

## 6. Go 后端导出 API（exported identifiers）

> 仅列出 `backend/` 内对外导出的 Go 标识符（大写开头），便于维护者快速定位“可复用公共能力”。

### 6.1 `internal/config`

#### `type Config`
- 字段含义：
  - `API APIConfig`：API 服务配置
  - `Database DatabaseConfig`：Postgres 配置
  - `Redis RedisConfig`：Redis 配置
  - `MinIO MinIOConfig`：对象存储配置
  - `JWT JWTConfig`：JWT 密钥与 TTL
  - `ClamAV ClamAVConfig`：病毒扫描服务
  - `Worker WorkerConfig`：worker 运行参数
  - `InternalAPISecret string`：内部接口共享密钥

#### `type APIConfig`
包含 API 相关配置（端口、限额、限流、上传限制、下载 token TTL、WebSocket 允许源、Cookie 域等）。

#### `type DatabaseConfig`
- `func (DatabaseConfig) DSN() string`：构造 lib/pq DSN（`host/port/user/password/dbname/sslmode`）

#### `type RedisConfig` / `type MinIOConfig` / `type ClamAVConfig` / `type WorkerConfig` / `type JWTConfig`
分别描述对应组件所需配置。

#### `func Load() (*Config, error)`
从环境变量读取配置，填充默认值并做校验（含 duration 解析与 Base64 PEM 解码）。

#### `func MustLoad() *Config`
`Load` 的 panic 版本（用于 `cmd/api` 与 `cmd/worker` 启动）。

### 6.2 `internal/auth`

#### `type AuthService`
JWT 与密码哈希服务。

#### `type TokenPair`
- `AccessToken string`
- `RefreshToken string`

#### `type TokenClaims`
JWT Claims（包含 `user_id`、`token_type`、`must_change_password` 以及标准 RegisteredClaims）。

#### `func NewAuthService(privateKeyPEM, publicKeyPEM []byte, accessTTL, refreshTTL time.Duration) (*AuthService, error)`
解析 RSA PEM 并构造服务。

#### `func HashPassword(password string) (string, error)`
基于 bcrypt 生成密码哈希。

#### `func CheckPasswordHash(password, hash string) bool`
校验明文与哈希是否匹配。

#### `func (s *AuthService) HashPassword(password string) (string, error)`
`HashPassword` 的方法封装。

#### `func (s *AuthService) CheckPasswordHash(password, hash string) bool`
`CheckPasswordHash` 的方法封装。

#### `func (s *AuthService) GenerateTokenPair(userID uint, mustChangePassword bool) (TokenPair, error)`
生成 access/refresh 两类 JWT。

#### `func (s *AuthService) ValidateToken(tokenString string) (*TokenClaims, error)`
校验并解析 JWT（强制 RS256）。

#### `func (s *AuthService) AccessTokenTTL() time.Duration` / `func (s *AuthService) RefreshTokenTTL() time.Duration`
返回配置的 TTL。

### 6.3 `internal/database`

#### `func InitDatabase(cfg config.DatabaseConfig) (*gorm.DB, error)`
初始化 GORM + Postgres，设置连接池并 `Ping()`。

#### `type User`
用户表模型（含 `MustChangePassword`、`ActiveResumeID`、`Resumes` 等）。

#### `type Resume`
简历表模型（JSONB `Content`、`PdfUrl`、`PreviewImageURL`、`PreviewObjectKey` 等）。

#### `type Template`
模板表模型（JSONB `Content`、公开/私有标记、预览图字段等）。

#### `type Asset`
资产表模型（`ObjectKey` 唯一，记录 content type 与 size）。

### 6.4 `internal/storage`

#### `type Client`
MinIO/S3 兼容存储客户端封装。

#### `type ObjectMeta`
列举对象的元信息（`Key/Size/LastModified`）。

#### `func NewClient(cfg config.MinIOConfig) (*Client, error)`
初始化 internal/public 两个 MinIO client，并按配置确保 bucket 存在（可关闭自动创建）。

#### `func (c *Client) UploadFile(ctx context.Context, objectName string, reader io.Reader, size int64, contentType string) (*minio.UploadInfo, error)`
上传对象。

#### `func (c *Client) GetObject(ctx context.Context, objectKey string) (*minio.Object, error)`
读取对象（私有 bucket）。

#### `func (c *Client) GeneratePresignedURL(ctx context.Context, objectKey string, duration time.Duration) (string, error)`
生成预签名 GET URL（public endpoint client）。

#### `func (c *Client) GeneratePresignedURLWithParams(ctx context.Context, objectKey string, duration time.Duration, params map[string]string) (string, error)`
生成带 response 参数的预签名 URL。

#### `func (c *Client) ListObjects(ctx context.Context, prefix string, limit int) ([]ObjectMeta, error)`
列出前缀下对象（递归）。

#### `func (c *Client) DeleteObject(ctx context.Context, objectKey string) error`
删除对象（对象不存在视为成功）。

#### `func (c *Client) DeletePrefix(ctx context.Context, prefix string) error`
删除前缀下的所有对象。

#### `func IsNoSuchKey(err error) bool` / `func IsNoSuchBucket(err error) bool`
判断 MinIO/S3 错误类型。

### 6.5 `internal/tasks`

#### `type PDFGeneratePayload` / `type TemplatePreviewPayload`
Asynq payload 结构（见上）。

#### `func NewPDFGenerateTask(id uint, correlationID string) (*asynq.Task, error)`
构造 PDF 生成任务。

#### `func NewTemplatePreviewTask(templateID uint, correlationID string) (*asynq.Task, error)`
构造模板预览任务。

### 6.6 `internal/worker`

#### `type PDFTaskHandler`
消费 `pdf:generate` 任务：拉取打印数据 -> 渲染打印页 -> 导出 PDF -> 上传 -> 更新 DB -> Redis 通知。

#### `func NewPDFTaskHandler(db *gorm.DB, storage *storage.Client, redisClient *redis.Client, logger *slog.Logger, internalSecret, internalAPIBaseURL, frontendBaseURL string) *PDFTaskHandler`
构造 handler。

#### `func (h *PDFTaskHandler) ProcessTask(ctx context.Context, t *asynq.Task) error`
Asynq handler 实现。

#### `type TemplatePreviewHandler`
消费 `template:generate_preview` 任务：渲染模板打印页并截图上传，更新模板预览字段。

#### `func NewTemplatePreviewHandler(db *gorm.DB, storageClient *storage.Client, logger *slog.Logger, internalSecret, internalAPIBaseURL, frontendBaseURL string) *TemplatePreviewHandler`
构造 handler。

#### `func (h *TemplatePreviewHandler) ProcessTask(ctx context.Context, t *asynq.Task) error`
Asynq handler 实现。

#### `type PDFGenerationNotifyMessage`
Redis -> WebSocket 的通知结构（见上）。

### 6.7 `internal/api`（HTTP/WebSocket 处理层）

#### `func RegisterRoutes(router *gin.Engine, db *gorm.DB, asynqClient *asynq.Client, authService *auth.AuthService, redisClient *redis.Client, logger *slog.Logger, storageClient *storage.Client, internalAPISecret, clamdAddr string, maxResumes, maxTemplates, maxAssetsPerUser, maxUploadsPerDay int, allowedOrigins []string, loginRateLimitPerHour, loginLockThreshold int, loginLockTTL time.Duration, pdfRateLimitPerHour int, pdfDownloadTokenTTL time.Duration, uploadMaxBytes int, uploadMIMEWhitelist []string, cookieDomain string)`
注册所有 `/v1` 路由（不包含 `/api` 前缀），并组装各 handler/middleware。

#### `type AuthHandler` / `type ResumeHandler` / `type AssetHandler` / `type TemplateHandler` / `type WsHandler`
分别对应认证、简历、资产、模板、WebSocket 的 Handler。

#### 构造函数
- `func NewAuthHandler(db *gorm.DB, authService *auth.AuthService, redisClient redis.UniversalClient, logger *slog.Logger, loginRateLimitPerHour, loginLockThreshold int, loginLockTTL time.Duration, cookieDomain string) *AuthHandler`
- `func NewResumeHandler(db *gorm.DB, asynqClient *asynq.Client, storageClient *storage.Client, internalSecret string, maxResumes int, redisClient *redis.Client, pdfRateLimitPerHour int, pdfDownloadTokenTTL time.Duration) *ResumeHandler`
- `func NewAssetHandler(db *gorm.DB, storageClient *storage.Client, logger *slog.Logger, clamdAddr string, redisClient *redis.Client, maxAssetsPerUser int, maxUploadsPerDay int, maxBytes int, mimeWhitelist []string) *AssetHandler`
- `func NewTemplateHandler(db *gorm.DB, asynqClient *asynq.Client, storageClient *storage.Client, internalSecret string, maxTemplates int) *TemplateHandler`
- `func NewWsHandler(redisClient *redis.Client, authService *auth.AuthService, logger *slog.Logger, allowedOrigins []string) *WsHandler`

#### 典型方法（HTTP handler method）
- `(*AuthHandler).Register/Login/Refresh/Logout/ChangePassword`
- `(*ResumeHandler).CreateResume/GetLatestResume/ListResumes/GetResume/UpdateResume/DeleteResume/DownloadResume/GetDownloadLink/DownloadResumeFile/GetPrintResumeData`
- `(*AssetHandler).UploadAsset/ListAssets/GetAssetURL/DeleteAsset`
- `(*TemplateHandler).CreateTemplate/DeleteTemplate/ListTemplates/GetTemplate/GeneratePreview/GetPrintTemplateData`
- `(*WsHandler).HandleConnection`

#### 通用响应辅助函数（`internal/api/response.go`）
- `func Error(c *gin.Context, status int, msg string)`
- `func AbortUnauthorized(c *gin.Context)`
- `func Unauthorized(c *gin.Context)`
- `func BadRequest(c *gin.Context, msg string)`
- `func Forbidden(c *gin.Context, msg string)`
- `func NotFound(c *gin.Context, msg string)`
- `func Conflict(c *gin.Context, msg string)`
- `func Internal(c *gin.Context, msg string)`

#### 打印数据构建（`internal/api/print_data.go`）
- `type PrintData`：见上
- `type RemovedImageItem`：记录被移除的 image item（原因、key 等）
- `func BuildPrintData(ctx context.Context, storageClient *storage.Client, ownerID uint, rawJSON []byte) (PrintData, []RemovedImageItem, error)`：构建打印数据并内联图片
- `func LogRemovedImageItems(log *slog.Logger, removed []RemovedImageItem)`：记录移除项（warn）

#### Middleware（`internal/api/middleware`）
- `func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc`：校验 Bearer access token 并注入 `userID`
- `func RequirePasswordChangeCompletedMiddleware() gin.HandlerFunc`：阻止未改密账号访问业务接口
- `func InternalSecretMiddleware(secret string) gin.HandlerFunc`：校验 `X-Internal-Secret`
- `func CorrelationIDMiddleware() gin.HandlerFunc` / `func GetCorrelationID(c *gin.Context) string`
- `func SlogLoggerMiddleware(logger *slog.Logger) gin.HandlerFunc` / `func LoggerFromContext(c *gin.Context) *slog.Logger`

### 6.8 `internal/metrics`
- `func GinMiddleware() gin.HandlerFunc`：HTTP 指标
- `func AsynqMetricsMiddleware() asynq.MiddlewareFunc`：任务指标

### 6.9 `internal/resume`
- `type Content` / `type LayoutSettings` / `type Item` / `type Layout`：简历内容的结构化表示（与 JSONB 内容字段对应）
