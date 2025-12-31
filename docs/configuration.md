<!--
配置说明：
- 后端统一通过 backend/internal/config/config.go 从环境变量读取配置（Viper + defaults + validate）。
- 本文档同时纳入 docker-compose 层变量（根目录 .env.example / .env.prod.example / compose 文件中的变量）。
- 对“存在于样例/compose 但代码未读取”的变量，会按现状标注【未使用/遗留】。
-->

# 配置项说明（Environment Variables）

## 1. 配置来源与优先级

### 1.1 后端（API/Worker）

后端读取环境变量的入口：
- `backend/internal/config.Load()`：读 env、应用默认值、解析 duration/Base64 PEM、校验必填项
- `backend/internal/config.MustLoad()`：启动用，失败直接 panic

读取顺序（简述）：
1) 环境变量（env）
2) 若未提供则使用默认值（见 `setDefaults`）
3) 应用别名（例如 `POSTGRES_DB` 与 `DB_NAME` 取第一个非空）
4) 做 normalize + validate

### 1.2 docker-compose（本地与生产）

- 本地：根目录 `.env.example` → 复制为 `.env` 后由 `docker-compose.yml` 引用
- 生产：根目录 `.env.prod.example` → 复制为生产服务器的 `.env` 后由 `docker-compose.prod.yml` 引用

### 1.3 前端（Next.js）

前端运行时相关变量：
- `API_INTERNAL_URL`：用于 Next.js rewrite，把浏览器侧 `/api/*` 代理到后端（服务端侧）
- `NEXT_PUBLIC_API_BASE_URL`：浏览器端请求 API 的 base（会注入到客户端 bundle）
- `NEXT_PUBLIC_INTERNAL_API_URL`：浏览器端内部打印 API base（当前主要用于构造路径；内部接口对外被拦截）

## 2. 变量清单（按模块分组）

> 表格中的“默认值”以代码默认或示例文件为准；生产环境务必显式设置密钥/口令。

### 2.1 生产部署与镜像（docker-compose.prod.yml）

| 变量 | 示例/默认 | 作用域 | 说明 |
|---|---|---|---|
| `GHCR_OWNER` | `YOUR_GITHUB_ORG_OR_USER` | 生产 compose | GHCR 镜像命名空间（`ghcr.io/<owner>/...`） |
| `APP_VERSION` | `latest` | 生产 compose | 镜像 tag，用于灰度/回滚 |

### 2.2 Postgres / 数据库

#### 2.2.1 根目录 compose 层（本地 `.env`）

| 变量 | 示例/默认 | 作用域 | 说明 |
|---|---|---|---|
| `DB_USER` | `phresume` | 本地 compose | 传给 Postgres 容器，映射为 `POSTGRES_USER` |
| `DB_NAME` | `phresume` | 本地 compose | 传给 Postgres 容器，映射为 `POSTGRES_DB` |
| `DB_PASSWORD` | `CHANGE_ME_STRONG_PASSWORD` | 本地 compose | 传给 Postgres 容器，映射为 `POSTGRES_PASSWORD` |

> 同时注意：`docker-compose.yml` 会把这些值传递给 API/Worker，使后端可通过别名读取（见 2.2.2）。

#### 2.2.2 后端配置（API/Worker）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `DATABASE_HOST` | `localhost` | 是 | Postgres Host |
| `DATABASE_PORT` | `5432` | 是 | Postgres Port |
| `DATABASE_SSLMODE` | `disable` | 是 | `disable/require/verify-ca/verify-full` 等（交给 lib/pq） |
| `POSTGRES_DB` / `DB_NAME` | `phresume` | 是 | 数据库名（别名：优先取第一个非空） |
| `POSTGRES_USER` / `DB_USER` | `phresume` | 是 | 用户名 |
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | `phresume` | 是 | 密码（示例默认仅用于开发，生产必须替换） |

### 2.3 Redis

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `REDIS_HOST` | `localhost` | 是 | Redis Host（用于 Asynq 队列与 WS 通知） |
| `REDIS_PORT` | `6379` | 是 | Redis Port |

### 2.4 对象存储（S3/COS/MinIO 兼容）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `MINIO_ENDPOINT` | `localhost:9000` | 是 | 内网访问地址（API/Worker 读写对象） |
| `MINIO_PUBLIC_ENDPOINT` | `http://localhost:9000` | 是 | 对外访问地址（用于生成预签名 URL 的 host/scheme） |
| `MINIO_ACCESS_KEY_ID` / `MINIO_ROOT_USER` | （无） | 是 | Access Key（本地 compose 下通常与 MinIO root user 一致） |
| `MINIO_SECRET_ACCESS_KEY` / `MINIO_ROOT_PASSWORD` | （无） | 是 | Secret Key |
| `MINIO_USE_SSL` | `false` | 是 | `true/false`（内部 client 是否走 TLS） |
| `MINIO_BUCKET` | `resumes` | 是 | 私有桶名（PDF、缩略图、用户资产都在此桶） |
| `MINIO_REGION` | `us-east-1` | 是 | 区域字段（MinIO 也需要） |
| `MINIO_BUCKET_LOOKUP` | `auto` | 是 | bucket lookup：`auto/dns/path` |
| `MINIO_AUTO_CREATE_BUCKET` | `true`(开发) / `false`(生产建议) | 是 | 是否自动创建 bucket |

### 2.5 安全密钥（内部接口 + JWT）

#### 2.5.1 INTERNAL_API_SECRET

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `INTERNAL_API_SECRET` | （无） | 是 | Worker 调用内部打印数据接口的共享密钥（header `X-Internal-Secret`） |

#### 2.5.2 JWT（RS256）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `JWT_PRIVATE_KEY` | （无） | 是 | Base64 编码的 RSA 私钥 PEM（不要带换行） |
| `JWT_PUBLIC_KEY` | （无） | 是 | Base64 编码的 RSA 公钥 PEM |
| `JWT_ACCESS_TOKEN_TTL` | `15m` | 是 | access token 有效期（Go `time.ParseDuration`） |
| `JWT_REFRESH_TOKEN_TTL` | `168h` | 是 | refresh token 有效期 |

> 生成方式参考 `README.md` 中的 openssl 示例。

### 2.6 ClamAV（病毒扫描）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `CLAMAV_HOST` | `clamav` | 是 | ClamAV daemon host（compose 内默认服务名） |
| `CLAMAV_PORT` | `3310` | 是 | ClamAV 端口 |

### 2.7 API 服务配置（限额/限流/安全）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `API_PORT` | `8080` | 是 | API 监听端口 |
| `API_MAX_RESUMES` | `3` | 是 | 每用户最大简历数量（`0` 表示不限制，但当前 validate 要求 >0） |
| `API_MAX_TEMPLATES` | `2` | 是 | 每用户最大私有模板数量 |
| `API_MAX_ASSETS_PER_USER` | `4` | 是 | 每用户最大资产数量（图片） |
| `API_MAX_UPLOADS_PER_DAY` | `4` | 是 | 每用户每日上传次数上限（`rate:upload:day:<uid>:<yyyymmdd>`） |
| `API_LOGIN_RATE_LIMIT_PER_HOUR` | `10` | 是 | 登录频控：每 `IP+username+hour` 的尝试次数上限 |
| `API_LOGIN_LOCK_THRESHOLD` | `5` | 是 | 连续失败次数阈值，达到后锁定 |
| `API_LOGIN_LOCK_TTL` | `30m` | 是 | 锁定时间（duration） |
| `API_ALLOWED_ORIGINS` | 空 | 是 | WebSocket Origin 白名单，逗号分隔；空则仅同源 |
| `API_UPLOAD_MAX_BYTES` | `5242880` | 是 | 上传最大体积（字节，默认 5MB） |
| `API_UPLOAD_MIME_WHITELIST` | `image/png,image/jpeg,image/webp` | 是 | 上传 MIME 白名单（逗号分隔） |
| `API_PDF_RATE_LIMIT_PER_HOUR` | `3` | 是 | PDF 生成频控：每用户每小时允许触发次数 |
| `API_PDF_DOWNLOAD_TOKEN_TTL` | `60s` | 是 | PDF 下载一次性 Token TTL（duration） |
| `API_COOKIE_DOMAIN` | 空 | 是 | refresh token Cookie 的 Domain；空表示跟随当前 host |

#### 2.7.1 【未使用/遗留】上传限流变量

以下变量在 `docker-compose.prod.yml` 与 `backend/.env.example` 中出现，但后端代码当前未绑定读取：
- `API_UPLOAD_RATE_LIMIT_PER_HOUR`

当前实际生效的是：
- `API_MAX_UPLOADS_PER_DAY`（按“天”计数），以及 `API_MAX_ASSETS_PER_USER`（总量上限）

建议（仅文档说明，不做代码修改）：统一在配置文件中移除/改名该变量，以免误导。

### 2.8 Worker 配置（PDF/预览渲染与指标）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `WORKER_INTERNAL_API_BASE_URL` | `http://api:8080` | 是 | Worker 访问 API 的 base（用于拉取内部打印数据） |
| `WORKER_FRONTEND_BASE_URL` | `http://frontend:3000` | 是 | Worker 访问前端打印页的 base |
| `WORKER_CONCURRENCY` | `10`(开发) / `3`(生产建议) | 是 | Asynq worker 并发数；Chromium 渲染较吃资源 |
| `WORKER_METRICS_ADDR` | `:9100` | 是 | Worker Prometheus 指标监听地址 |

### 2.9 可观测性（compose 层）

> 这部分主要由 `docker-compose.yml` 的 Loki/Promtail/Prometheus/Grafana 使用；后端自身不读取这些变量。

| 变量 | 示例/默认 | 作用域 | 说明 |
|---|---|---|---|
| `GRAFANA_USER` | `admin` | 本地 compose | Grafana 管理员账号 |
| `GRAFANA_PASSWORD` | `CHANGE_ME_STRONG_PASSWORD` | 本地 compose | Grafana 管理员密码 |

### 2.10 前端（Next.js）

| 变量 | 默认值 | 必填 | 说明 |
|---|---:|:---:|---|
| `API_INTERNAL_URL` | `http://localhost:8080` | 否 | Next.js server-side rewrite 的目标 API（`/api/*` → `${API_INTERNAL_URL}/*`） |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | 否 | 浏览器端 API base；本地 compose 示例为 `http://localhost/api` |
| `NEXT_PUBLIC_INTERNAL_API_URL` | `/api` | 否 | 浏览器端 internal API base（内部打印接口对外通常不可访问） |

## 3. 常见配置组合

### 3.1 Docker本地一键启动（docker-compose.yml）

关键点：
- `MINIO_PUBLIC_ENDPOINT` 在本地 compose 中通常配置为 `http://localhost:9000`，确保预签名 URL 可被浏览器访问
- `NEXT_PUBLIC_API_BASE_URL` 建议为 `http://localhost/api`（与 Nginx `/api` 反代一致）

### 3.2 生产部署（docker-compose.prod.yml）

关键点：
- API/Worker/Frontend 容器多为只读文件系统 + tmpfs，需确保外部依赖（Postgres/Redis/对象存储）稳定可用
- `MINIO_PUBLIC_ENDPOINT` 应填写公网可访问地址（一般为 HTTPS 域名）
- Nginx 默认拦截 `/api/v1/(resume|templates)/print/*` 与 `/api/metrics`，避免内部接口暴露
