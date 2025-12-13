# 上云与 CI/CD（单机 docker compose + 同机自建 DB/Redis）

> 目标：单台云服务器只暴露 `80/443`，业务通过 Nginx 对外；Postgres/Redis 同机自建（compose 里跑）；对象存储使用托管；GitHub Actions 自动构建镜像并 SSH 部署。

## 关键结论（迁移前必须想清楚）

1. **生产运行模式必须从 dev 切换到 prod**
   - 生产不应使用 `air`/源码挂载/`next dev`；镜像应不可变（可回滚）。
2. **对外暴露面收敛到 Nginx**
   - 默认只对外暴露 Nginx；DB/Redis 不对外暴露。
   - 如果你需要远程管理 Postgres：建议用 SSH Tunnel；若必须开 5432，请在云安全组只放行你的 IP。
3. **Worker 的 PDF 渲染链路依赖“内网可达的前端地址”**
   - Worker 需要访问 `WORKER_FRONTEND_BASE_URL` 的 `/print/:id`；同时还需要直连 API 的内部打印接口。
4. **对象存储要配置对外可访问的 public endpoint**
   - 预签名 URL 的域名由 `MINIO_PUBLIC_ENDPOINT` 决定，生产应使用 HTTPS 域名而非内网地址。
5. **备份/恢复是“是否敢上线”的门槛**
   - 同机 Postgres 与对象存储必须至少有备份策略与一次恢复演练。

## 仓库内生产文件

- `docker-compose.prod.yml`：生产 compose（仅 API/Worker/Frontend/Nginx/ClamAV）。
- `deploy/nginx/nginx.prod.conf`：生产 Nginx 配置（阻断内部打印接口与 `/api/metrics`）。

## GitHub Actions（建议）

- CI：`go test ./...` + `npm run lint` + `npm run build`
- CD：构建并推送 GHCR 镜像，然后 SSH 到服务器执行 `docker compose pull && docker compose up -d`
