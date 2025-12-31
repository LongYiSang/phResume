# phResume

拼好历是一个所见即所得的简历编辑与异步 PDF 生成系统。

## 项目示例

### 纯前端Demo
- 本项目有一个纯前端的功能示例：github.com/LongYiSang/PinResume
- 体验地址：longyisang.icu

## 快速上手

### 前置要求
- Git
- Docker + Docker Compose（v2）


### 安装步骤
```bash
git clone https://github.com/LongYiSang/phResume.git
cd phResume
cp .env.example .env
```

### 配置说明
`.env` 中以下字段必须替换为可用值：
- `DB_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `GRAFANA_PASSWORD`
- `INTERNAL_API_SECRET`
- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`

生成 JWT 密钥（PEM + Base64，示例）：
```bash
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
openssl base64 -A -in jwt_private.pem
openssl base64 -A -in jwt_public.pem
```
将输出内容分别填入 `.env` 的 `JWT_PRIVATE_KEY` 与 `JWT_PUBLIC_KEY`。

### 运行示例
```bash
docker-compose up --build
```

首次启动会拉取镜像并初始化服务，完成后直接在浏览器访问 `http://localhost` 即可进入系统。

## 项目结构 / 模块说明
- `backend/cmd/api`：Gin API 入口，负责认证、简历/模板 CRUD、资产上传与 ClamAV 扫描、任务入队与指标。
- `backend/cmd/worker`：Asynq Worker，使用 go-rod 渲染 `/print/:id` 页面并导出 PDF，写入 MinIO 后通过 Redis 通知前端。
- `backend/cmd/admin`：初始化管理员账号的 CLI 工具（首次部署可用）。
- `backend/internal`：核心业务与基础能力（auth/JWT、config、database/GORM、storage/MinIO、tasks/Asynq、metrics）。
- `frontend/app`：Next.js 编辑器、登录注册、打印页与模板预览。
- `deploy`：Nginx 与可观测性组件（Prometheus/Loki/Promtail/Grafana）配置。
- `docker-compose.yml`：本地一键启动完整依赖栈。

## 核心流程
用户在编辑器中拖拽排版与保存简历，API 将任务入队；Worker 拉取任务并访问前端打印页生成 PDF，上传 MinIO 后通过 WebSocket/Redis 通知前端，最终给出可下载链接。

## 核心功能
- 24 列网格画布拖拽编辑，所见即所得排版。
- 异步 PDF 生成，生成完成后通过 WebSocket 实时通知。
- 资产上传与 ClamAV 扫描，MinIO 私有桶 + 预签名下载链接。
- 模板保存与复用，支持持续迭代简历样式。
- 可观测性内建（Prometheus + Loki + Grafana），便于排错与运维。

面向“编辑不中断 + 稳定导出”的简历编辑场景，适合需要批量生成、异步通知与对象存储集成的团队或产品。

## 详细文档 / API
- 部署说明：`deploy/README-server.md`
- 详细文档：详见`docs`

## 许可证
Licensed under the MIT License. See `LICENSE`.
