# phResume 项目说明（已实现）

本文档仅描述当前已实现的后端、前端与部署架构。所有接口、组件与配置均以代码库现状为准，不包含尚未落地的规划内容。

## 目录

- [后端系统说明](#后端系统说明)
- [前端系统说明](#前端系统说明)
- [部署架构说明](#部署架构说明)

---

## 后端系统说明

### 技术栈与结构

- 语言与框架：Go + Gin（`backend/cmd/api` 启动 API，`backend/cmd/worker` 启动任务处理）
- 任务队列：Asynq（Redis）
- 存储：PostgreSQL（GORM）、MinIO（预签名访问）
- 安全：JWT RS256（访问令牌 + 刷新令牌）
- 可观测性：Prometheus 指标、Loki/Promtail 日志，Grafana 仪表盘

### 认证与授权机制

- JWT RS256：`AuthService` 负责签发与校验（`backend/internal/auth/auth_service.go:39-58`, `backend/internal/auth/auth_service.go:113-137`）。
  - 访问令牌：`token_type=access`，有效期来自环境变量 `JWT_ACCESS_TOKEN_TTL`。
  - 刷新令牌：`token_type=refresh`，`jti` 随机 UUID，有效期来自 `JWT_REFRESH_TOKEN_TTL`，通过 Cookie 传递并在刷新/退出时加入黑名单（`backend/internal/api/auth_handler.go:279-291`）。
- 访问控制：`AuthMiddleware` 校验 `Authorization: Bearer <access_token>` 并注入 `userID`（`backend/internal/api/middleware/auth_middleware.go:9-42`）。
- WebSocket：建立连接后，客户端发送 `{"type":"auth","token":"<access_token>"}` 完成鉴权；服务端随后订阅并转发用户频道 `user_notify:<userID>` 消息（`backend/internal/api/ws_handler.go:64-123`, `backend/internal/api/ws_handler.go:148-191`）。
- Worker 内部访问：渲染打印数据接口使用 `internal_token` 查询参数校验（`backend/internal/api/resume_handler.go:465-476`, `backend/internal/api/template_handler.go:274-283`）。

### 数据库结构与 ORM 映射

模型定义（GORM）：`backend/internal/database/models.go:8-27`

```go
type User struct {
  gorm.Model
  Username       string   `gorm:"uniqueIndex;size:64"`
  PasswordHash   string   `gorm:"size:255"`
  Resumes        []Resume `gorm:"constraint:OnDelete:CASCADE"`
  ActiveResumeID *uint
}

type Resume struct {
  gorm.Model
  Title           string         `gorm:"size:255"`
  Content         datatypes.JSON `gorm:"type:jsonb"`
  UserID          uint           `gorm:"index"`
  User            User           `gorm:"constraint:OnDelete:CASCADE"`
  PdfUrl          string         `gorm:"size:512"`
  Status          string         `gorm:"size:32"`
  PreviewImageURL string         `gorm:"size:512"`
}

type Template struct {
  gorm.Model
  Title           string         `gorm:"size:255"`
  PreviewImageURL string         `gorm:"size:512"`
  Content         datatypes.JSON `gorm:"type:jsonb"`
  IsPublic        bool           `gorm:"default:false"`
  UserID          uint           `gorm:"index"`
  User            User           `gorm:"constraint:OnDelete:CASCADE"`
}
```

- 约束与关系：`User(1) - Resume(N)`，`User(1) - Template(N)`，级联删除；`User.ActiveResumeID` 标记当前活跃简历。
- `Resume.Content` 与 `Template.Content` 为 JSONB，结构参见打印接口返回（布局设置与 items）。

### API 列表与规范（仅已实现）

通用端点：

- `GET /health`：健康检查（`backend/cmd/api/main.go:111-114`）。
- `GET /metrics`：Prometheus 指标（`backend/cmd/api/main.go:114`）。

鉴权与会话（`/v1/auth`）：

- `POST /v1/auth/register`
  - 请求体：`{ "username": string(min=3,max=64), "password": string(min=8,max=72) }`
  - 响应：`201 Created`；失败：`400 Bad Request`（入参错误）、`409 Conflict`（用户名存在）、`500`。
  - 参考：`backend/internal/api/auth_handler.go:41-88`。

- `POST /v1/auth/login`
  - 请求体：`{ "username": string, "password": string }`
  - 响应：`200 OK`，`{ "access_token": string, "token_type": "Bearer", "expires_in": number }`；同时设置刷新令牌 Cookie。
  - 失败：`400`、`401`、`500`。
  - 参考：`backend/internal/api/auth_handler.go:92-140`。

- `POST /v1/auth/refresh`
  - 令牌来源：Cookie `refresh_token` 或请求体 `{ "refresh_token": string }`。
  - 响应：`200 OK`，同登录；旋转旧刷新令牌并加入黑名单。
  - 失败：`401`（令牌无效/被撤销/类型错误）、`500`。
  - 参考：`backend/internal/api/auth_handler.go:144-235`。

- `POST /v1/auth/logout`（需要 `Authorization`）
  - 行为：将当前刷新令牌加入黑名单并清除 Cookie。
  - 响应：`200 OK`；失败：`401`、`500`。
  - 参考：`backend/internal/api/auth_handler.go:237-311`。

WebSocket（`/v1/ws`）：

- 握手：连接后发送 `{"type":"auth","token":"<access_token>"}` 完成鉴权。
- 服务端将 Redis Pub/Sub `user_notify:<userID>` 的 JSON 消息透传给客户端。
- 失败：鉴权异常导致连接关闭（`policy_violation` / `unauthorized`）。
- 参考：`backend/internal/api/ws_handler.go:25-39, 64-123, 148-191`。

简历（`/v1/resume`，需要 `Authorization`）：

- `GET /v1/resume`：列出我的简历。
  - 响应：`200 OK`，`[{ id, title, preview_image_url, created_at }]`；失败：`500`。
  - 参考：`backend/internal/api/resume_handler.go:149-177`。

- `GET /v1/resume/latest`：返回最近简历或默认模板。
  - 响应：`200 OK`，`{ id, title, content, preview_image_url, created_at, updated_at }`；失败：`500`。
  - 参考：`backend/internal/api/resume_handler.go:121-146`。

- `POST /v1/resume`
  - 请求体：`{ title: string, content: JSON, preview_image_url?: string }`
  - 响应：`201 Created`，返回完整简历；失败：`403`（数量上限）、`400`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:68-118`。

- `GET /v1/resume/:id`
  - 响应：`200 OK`，返回完整简历并标记为活跃；失败：`400`、`404`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:179-206`。

- `PUT /v1/resume/:id`
  - 请求体同 `POST /v1/resume`。
  - 响应：`200 OK`，返回更新后简历；失败：`400`、`404`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:208-260`。

- `DELETE /v1/resume/:id`
  - 响应：`204 No Content`；失败：`400`、`404`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:261-290`。

- `GET /v1/resume/:id/download`
  - 行为：入队 PDF 生成任务（Asynq），立即返回。
  - 响应：`202 Accepted`，`{ message, task_id }`；失败：`400`、`404`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:364-404`。

- `GET /v1/resume/:id/download-link`
  - 行为：若 `pdf_url` 已生成，返回 5 分钟有效的 MinIO 预签名下载链接。
  - 响应：`200 OK`，`{ url }`；失败：`409 Conflict`（PDF 尚未生成）、`400`、`404`、`500`。
  - 参考：`backend/internal/api/resume_handler.go:430-462`。

资产（`/v1/assets`，需要 `Authorization`）：

- `GET /v1/assets?limit=60`
  - 行为：列出我上传的图片资产，并为每个对象生成 10 分钟有效的 `previewUrl`。
  - 响应：`200 OK`，`{ items: [{ objectKey, previewUrl, size, lastModified }] }`；失败：`500`。
  - 参考：`backend/internal/api/asset_handler.go:96-141`。

- `POST /v1/assets/upload`（`multipart/form-data`）
  - 字段：`file`；上传前通过 ClamAV 扫描，命名规则 `user-assets/<userID>/<uuid>.png`。
  - 响应：`201 Created`，`{ objectKey }`；失败：`400`（缺少文件/恶意文件）、`500`。
  - 参考：`backend/internal/api/asset_handler.go:35-94`。

- `GET /v1/assets/view?key=<objectKey>`
  - 行为：校验对象归属后返回 15 分钟有效的预签名 URL。
  - 响应：`200 OK`，`{ url }`；失败：`400`、`403`、`500`。
  - 参考：`backend/internal/api/asset_handler.go:143-171`。

模板（`/v1/templates`，需要 `Authorization`）：

- `GET /v1/templates`
  - 行为：返回我的模板 ∪ 所有公开模板。
  - 响应：`200 OK`，`[{ id, title, preview_image_url, is_owner }]`；失败：`500`。
  - 参考：`backend/internal/api/template_handler.go:153-181`。

- `GET /v1/templates/:id`
  - 访问控制：仅 Owner 或公开模板。
  - 响应：`200 OK`，`{ id, title, content, preview_image_url }`；失败：`400`、`404`、`403`、`500`。
  - 参考：`backend/internal/api/template_handler.go:183-221`。

- `POST /v1/templates`
  - 请求体：`{ title: string, content: JSON }`（默认私有）。
  - 响应：`201 Created`，`{ id, title }`；失败：`403`（数量上限）、`400`、`500`。
  - 参考：`backend/internal/api/template_handler.go:67-110`。

- `POST /v1/templates/:id/generate-preview`
  - 行为：为模板生成预览缩略图；任务入队，Worker 完成后写入 `preview_image_url`（7 天有效预签名）。
  - 响应：`202 Accepted`，`{ message, task_id }`；失败：`400`、`404`、`403`、`500`。
  - 参考：`backend/internal/api/template_handler.go:223-271`，`backend/internal/worker/template_preview_handler.go:94-116`。

内部打印数据（供 Worker 渲染）：

- `GET /v1/resume/print/:id?internal_token=...` 返回布局与 items，图片以 Data URI 内联（不依赖预签名）（`backend/internal/api/resume_handler.go:465-511`, `backend/internal/api/print_helper.go:25-63`）。
- `GET /v1/templates/print/:id?internal_token=...` 同上（`backend/internal/api/template_handler.go:273-320`）。

---

## 前端系统说明

### 路由结构

```text
/                      — 主编辑器（所见即所得）
/login                 — 登录
/register              — 注册
/print/[id]            — Worker 使用的简历打印视图（内部）
/print-template/[id]   — Worker 使用的模板打印视图（内部）
```

### 业务组件与功能

- 编辑器与容器：
  - `PageContainer` 画布容器（`frontend/components/PageContainer.tsx`）
  - `Dock` 底部工具栏（`frontend/components/Dock.tsx`）
  - `Inspector` 属性面板（`frontend/components/Inspector.tsx`）
  - `StylePanel` 样式面板（`frontend/components/StylePanel.tsx`）

- 内容项组件：
  - `TextItem` 富文本（Lexical）（`frontend/components/TextItem.tsx:160-216`）
  - `ImageItem` 图片项（按需获取预签名 URL）（`frontend/components/ImageItem.tsx:16-103`）
  - `DividerItem` 分隔线（`frontend/components/DividerItem.tsx`）

- 侧栏面板：
  - `AssetsPanel` 资产管理（列出、插入、上传）（`frontend/components/AssetsPanel.tsx:50-98, 174-239`）
  - `TemplatesPanel` 模板管理（保存、列表、应用、生成预览）（`frontend/components/TemplatesPanel.tsx:25-47, 82-109, 153-177`）
  - `MyResumesPanel` 简历库（加载旧简历、另存为）（`frontend/components/MyResumesPanel.tsx:158-191`）

- 打印视图：
  - `PrintView` Worker 渲染专用组件，加载内部打印数据并在 `#pdf-render-ready` 节点标记可输出（`frontend/components/PrintView.tsx:64-112, 133-223`）。

- 登录页装饰组件（视觉）：`KawaiiMascot`、`TechParticles`、`TechFragments`、`TiltCard`（`frontend/components/landing/*`）。

### 页面与后端 API 调用关系

- `/` 主编辑器（`frontend/app/page.tsx`）
  - 鉴权与令牌：`/v1/auth/refresh`（刷新访问令牌，`AuthContext` 自动调用）（`frontend/context/AuthContext.tsx:35-76`）。
  - WebSocket：`/v1/ws`（任务完成通知，触发下载链接获取）（`frontend/app/page.tsx:313-374`）。
  - 简历：`GET /v1/resume/latest`、`GET/PUT /v1/resume/:id`、`POST /v1/resume`、`DELETE /v1/resume/:id`。
  - 下载：`GET /v1/resume/:id/download`（提交任务）→ WebSocket 完成后 `GET /v1/resume/:id/download-link`（打开 5 分钟链接）（`frontend/app/page.tsx:496-526, 272-303`）。
  - 资产：`GET /v1/assets`（列表，含 10 分钟 `previewUrl`）、`POST /v1/assets/upload`、`GET /v1/assets/view?key=...`（图片组件拉取 15 分钟链接）（`frontend/components/ImageItem.tsx:41-51`）。
  - 模板：`GET /v1/templates`、`GET /v1/templates/:id`（应用）、`POST /v1/templates`（保存）、`POST /v1/templates/:id/generate-preview`（生成预览）。

- `/login`（`frontend/app/login/page.tsx`）
  - `POST /v1/auth/login`（设置访问令牌，并由服务端设置刷新令牌 Cookie）。

- `/register`（`frontend/app/register/page.tsx`）
  - `POST /v1/auth/register`。

- `/print/[id]`（内部，仅 Worker 使用）
  - `GET /v1/resume/print/:id?internal_token=...`。

- `/print-template/[id]`（内部，仅 Worker 使用）
  - `GET /v1/templates/print/:id?internal_token=...`。

### 状态管理方案

- `AuthContext`：保存 `accessToken`、自动刷新访问令牌（读取刷新令牌 Cookie），并暴露 `refreshAccessToken()`；开机时试图刷新以检测会话（`frontend/context/AuthContext.tsx:35-76, 78-99`）。
- `useAuthFetch`：统一加上 `Authorization: Bearer <token>`，在 401 时自动尝试刷新令牌并重试（`frontend/hooks/useAuthFetch.ts:7-56`）。
- `ActiveEditorContext`：记忆当前活跃的 Lexical 编辑器实例（`frontend/context/ActiveEditorContext.tsx:1-51`）。
- 编辑器内部：使用本地 `useState` + 自定义历史栈（撤销/重做）管理布局与样式；栅格由 `react-grid-layout` 驱动。

### UI 组件库与第三方依赖

- UI：`@heroui/react`、Tailwind CSS 4（`frontend/app/globals.css`）、`lucide-react` 图标。
- 编辑器：`lexical` + `@lexical/*` 系列。
- 布局：`react-grid-layout`、`react-resizable`。
- 动画：`framer-motion`。
- 路由与运行时：Next.js 16，React 19。
- 其它：`uuid`。
- 代理与重写：前端将 `/api/:path*` 重写到 API 容器（`frontend/next.config.ts:4-17`）。

路由结构图（ASCII）：

```text
Nginx :80
  ├─ /            → frontend:3000 (Next.js)
  └─ /api/*       → api:8080     (Gin, 反向代理移除 /api 前缀)
       └─ /v1/ws  (WebSocket，支持 Upgrade/Connection)
```

---

## 部署架构说明

### Docker Compose 配置（已实现）

文件：`docker-compose.yml`

- 服务拆分：
  - `db`（PostgreSQL 15）、`redis`、`minio`、`api`、`frontend`、`nginx`、`worker`、`loki`、`promtail`、`prometheus`、`grafana`、`clamav`。
  - 所有服务加入 `app-network` 自定义 bridge 网络（`docker-compose.yml:1-5, 252-254`）。

- 关键环境变量映射：
  - 数据库：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`（`docker-compose.yml:6-10`）。
  - JWT：`JWT_PRIVATE_KEY`、`JWT_PUBLIC_KEY`、`JWT_ACCESS_TOKEN_TTL`、`JWT_REFRESH_TOKEN_TTL`（`docker-compose.yml:11-16`）。
  - API：`DATABASE_*`、`REDIS_*`、`API_PORT`、`MINIO_*`、`INTERNAL_API_SECRET`、`CLAMAV_HOST/PORT`（`docker-compose.yml:66-102`）。
  - FRONTEND：`NEXT_PUBLIC_API_BASE_URL`、`API_INTERNAL_URL`、`NEXT_PUBLIC_INTERNAL_API_URL`（`docker-compose.yml:103-117`）。
  - WORKER：复用数据库/Redis/MinIO 与 `INTERNAL_API_SECRET`（`docker-compose.yml:129-156`）。

- 端口与卷：
  - `db:5432`、`redis:6379`（暴露）
  - `minio:9000,9001`（S3 与控制台）
  - `api:8080`（内部，仅通过 Nginx 暴露）
  - `frontend:3000`（内部，仅通过 Nginx 暴露）
  - `nginx:80`（外部入口）
  - `worker:9100`（Prometheus 指标）
  - Loki/Promtail/Prometheus/Grafana：`3100/9080/9091/3000`（`docker-compose.yml:161-227`）
  - 卷：`pgdata`、`miniodata`、`loki_data`、`prometheus_data`、`grafana_data`、`clamav_data`（`docker-compose.yml:244-251`）。

### 容器化部署方案

- 反向代理：Nginx 将 `/api/*` 代理到 `api:8080`，移除 `/api` 前缀，并正确转发 WebSocket Upgrade/Connection（`deploy/nginx/nginx.conf:42-61`）。其余路径转发到 `frontend:3000`（`deploy/nginx/nginx.conf:62-71`）。
- 前端重写：Next.js 将 `/api/:path*` 重写到 API（`frontend/next.config.ts:4-17`）。
- 网络：全部服务加入 `app-network`，通过容器名互相访问。
- 上传限制：`client_max_body_size 10m`（`deploy/nginx/nginx.conf:33`）。

架构示意（ASCII）：

```text
[ Internet ]
     |
  Nginx :80
  ├─ / → frontend:3000 (Next.js 16)
  └─ /api/* → api:8080 (Gin)
                 ├─ Redis (asynq, ws pub/sub)
                 ├─ PostgreSQL (GORM)
                 ├─ MinIO (assets/pdf, presigned)
                 └─ ClamAV (upload scan)

Worker
  ├─ go-rod + PrintView → 生成 PDF/预览图
  ├─ 上传到 MinIO 并回写 DB
  └─ 通过 Redis Pub/Sub 通知前端

Observability
  ├─ Prometheus ← /metrics(api), :9100(worker)
  ├─ Loki + Promtail（容器日志）
  └─ Grafana（默认数据源 Prometheus + Loki）
```

### CI/CD 流水线

- 当前仓库未配置 CI/CD 工作流（未实现 `.github/workflows/*`）。

### 环境变量配置要求

- API/Worker（通过 Compose 注入）：
  - 数据库：`DATABASE_HOST`、`DATABASE_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`DATABASE_SSLMODE`。
  - Redis：`REDIS_HOST`、`REDIS_PORT`。
  - MinIO：`MINIO_ENDPOINT`、`MINIO_PUBLIC_ENDPOINT`、`MINIO_ACCESS_KEY_ID`、`MINIO_SECRET_ACCESS_KEY`、`MINIO_BUCKET`、`MINIO_USE_SSL`。
  - JWT：`JWT_PRIVATE_KEY`（Base64 PEM）、`JWT_PUBLIC_KEY`（Base64 PEM）、`JWT_ACCESS_TOKEN_TTL`、`JWT_REFRESH_TOKEN_TTL`。
  - 内部：`INTERNAL_API_SECRET`（Worker 与 API 共享，用于打印数据接口）。
  - ClamAV：`CLAMAV_HOST`、`CLAMAV_PORT`。

- 前端：
  - `NEXT_PUBLIC_API_BASE_URL`、`API_INTERNAL_URL`、`NEXT_PUBLIC_INTERNAL_API_URL`（反向代理与内部 API 地址）。
  - 可选：`NEXT_PUBLIC_WS_URL`（未在 Compose 显式设置，前端默认根据 `window.location` 拼接 `/api/v1/ws`）。

### 监控与日志收集方案

- Prometheus：
  - API 暴露 `/metrics`（`backend/cmd/api/main.go:114`），Worker 在 `:9100/metrics`（`backend/cmd/worker/main.go:63-71`）。
  - 采集配置使用 Docker 服务发现，保留 `service` 标签（`deploy/prometheus/prometheus.yml:9-32`）。主要指标：
    - HTTP：`phresume_http_request_duration_seconds{method,path,status}`（时延分布）、`phresume_http_requests_total{method,path,status}`（请求数）、`phresume_http_in_flight_requests`（并发）（`backend/internal/metrics/gin.go:15-44, 46-73`）。
    - Asynq：`phresume_asynq_tasks_*`（处理总数/失败/进行中）（`backend/internal/metrics/asynq.go:11-41, 44-61`）。

- Loki/Promtail：
  - Promtail 通过 Docker 服务发现采集容器日志，并区分 API/Worker（JSON）与 Nginx（Combined）日志（`deploy/promtail/promtail-config.yml:27-53`）。
  - Loki 文件系统存储（`deploy/loki/loki-config.yml:7-18, 19-28`）。Grafana 预先配置数据源与派生字段（`deploy/grafana/provisioning/datasources/datasources.yml:3-21`）。

- Grafana：
  - 默认数据源为 Prometheus，提供示例仪表盘（`deploy/grafana/provisioning/dashboards/main_dashboard.json`）。

---

## 示例：接口与打印数据

### 资产查看 URL（预签名）

```http
GET /api/v1/assets/view?key=user-assets/1234/abcd.png
Authorization: Bearer <access_token>

200 OK
{ "url": "https://minio.example.com/resumes/user-assets/1234/abcd.png?X-Amz-Expires=900&X-Amz-Signature=..." }
```

### Worker 打印数据（图片内联）

```http
GET /api/v1/resume/print/42?internal_token=<INTERNAL_API_SECRET>

200 OK
{
  "layout_settings": { "columns": 24, "row_height_px": 10, ... },
  "items": [
    { "id": "img-1", "type": "image", "content": "data:image/png;base64,iVBOR...", "layout": {"x":0,"y":0,"w":6,"h":8}, "style": {"borderRadius":"12px"} }
  ]
}
```
