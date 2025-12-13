# 服务器侧准备（最小可用）

> 目标：服务器只开放 `80/443`，其余依赖使用云厂商托管；由 GitHub Actions 通过 SSH 自动部署。

## 1. 安装 Docker + Compose 插件

- Ubuntu 22.04 常见做法：按 Docker 官方文档安装 `docker-ce` 与 `docker compose` 插件。
- 确认：`docker --version`、`docker compose version`

## 2. 创建部署目录与环境变量文件

示例路径：`/opt/phresume`

- 上传 `docker-compose.prod.yml` 与 `deploy/nginx/nginx.prod.conf`（CD 会自动覆盖更新）
- 在服务器创建 `/opt/phresume/.env`（参考仓库根目录 `.env.prod.example`）

## 3. 首次启动（手动）

```bash
cd /opt/phresume
export GHCR_OWNER=YOUR_GITHUB_ORG_OR_USER
export APP_VERSION=latest
docker compose -f docker-compose.prod.yml up -d
```

## 4. GitHub Secrets（CD 必填）

- `SSH_HOST`、`SSH_USER`、`SSH_PRIVATE_KEY`
- 可选：`SSH_PORT`、`DEPLOY_PATH`（默认 `/opt/phresume`）
- 若 GHCR 镜像为私有：在服务器上提前执行一次 `docker login ghcr.io`（PAT 至少 `read:packages`）
