# Repository Guidelines

## Project Structure & Module Organization
Use `项目规划/示例目录.md` as the layout blueprint. Keep planning notes inside `项目规划/` and mirror the documented tree as code ships. The Go backend belongs in `backend/` with entry points in `cmd/api` and `cmd/worker`; shared logic stays in `internal/` packages such as `internal/database`, `internal/tasks`, and `internal/config`. The Next.js client resides in `frontend/` (components, pages, styles, public assets). Deployment manifests live in `deploy/` (Nginx, Loki, Promtail, Prometheus, Grafana). Orchestration files (`docker-compose*.yml`) and CI workflows (`.github/workflows/`) remain at the root.

## Build, Test, and Development Commands
Backend: `cd backend && go run ./cmd/api` starts the API, and `go run ./cmd/worker` launches the Asynq worker. `go build ./cmd/...` verifies both binaries compile. Frontend: `cd frontend && npm install` once per clone, then `npm run dev` for local development and `npm run build && npm run start` to simulate production. Full stack: `docker-compose up --build` starts API, worker, PostgreSQL, Redis, MinIO, and frontend together. Keep scripts idempotent for CI.
When Go module downloads hit timeouts, rerun commands with `GOPROXY=https://goproxy.cn,direct` to leverage the mirror.

## Coding Style & Naming Conventions
Format Go code with `gofmt` (tabs, camelCase identifiers) and organize imports with `goimports`. Keep package names short and lower\_snake\_case. For React/Next.js, lean on Prettier defaults (2-space indent, single quotes) and run `npm run lint` before pushing; name components in PascalCase and files in kebab-case when route-related. Update `.env.example` files whenever variables change.

## Testing Guidelines
Write Go tests alongside code as `*_test.go` files and run `go test ./...` before submitting. Add table-driven cases for handlers, tasks, and stores; spin up temporary Postgres containers via Docker for integration coverage. For the frontend, place Jest/RTL specs under `frontend/__tests__/` or colocate with components using `.test.tsx` files, and execute `npm run test`. Failing CI blocks merges.

## Commit & Pull Request Guidelines
The history is forming, so adopt Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) with short scopes such as `feat(api): add resume uploader`. Rebase before opening PRs to keep linear history. Each PR should link issues, describe functional changes, list test evidence (`go test`, `npm run test`, screenshots for UI tweaks), and note migrations or config updates. Request review from backend and frontend maintainers when changes cross boundaries.

## Environment & Security Notes
Never commit real secrets. Document required variables in `.env.example`, inject actual values through environment variables (`docker-compose`/CI secrets), and keep TLS, JWT keys, and vendor credentials in your secret manager. When touching Docker images, ensure Chromium stays in the worker image and update deploy manifests under `deploy/` accordingly.

---

# AI助手核心规则

## 三阶段工作流

### 阶段一：分析问题

**声明格式**：`【分析问题】`

**目的**
因为可能存在多个可选方案，要做出正确的决策，需要足够的依据。

**必须做的事**：
- 深入理解需求本质
- 搜索所有相关代码
- 识别问题根因
- 发现并指出重复代码

做完以上事项，就可以向我提问了。

**融入的原则**：
- 系统性思维：看到具体问题时，思考整个系统
- 第一性原理：从功能本质出发，而不是现有代码
- DRY原则：任何重复代码都必须指出并优先处理
- 长远考虑：评估技术债务和维护成本

**绝对禁止**：
- ❌ 修改任何代码
- ❌ 急于给出解决方案
- ❌ 跳过搜索和理解步骤
- ❌ 不分析就推荐方案

**阶段转换规则**
本阶段你要向我提问。
如果存在多个你无法抉择的方案，要问我，作为提问的一部分。
如果没有需要问我的，则直接进入下一阶段。

### 阶段二：制定方案
**声明格式**：`【制定方案】`

**前置条件**：
- 我明确回答了关键技术决策。

**必须做的事**：
- 列出变更（新增、修改、删除）的文件，简要描述每个文件的变化
- 消除重复逻辑：如果发现重复代码，必须通过复用或抽象来消除
- 确保修改后的代码符合DRY原则和良好的架构设计

如果新发现了向我收集的关键决策，在这个阶段你还可以继续问我，直到没有不明确的问题之后，本阶段结束。
如果是简单修改，可以自动进入执行方案阶段，不用经过我确认。

### 阶段三：执行方案
**声明格式**：`【执行方案】`

**必须做的事**：
- 严格按照选定方案实现
- 修改后运行类型检查

**绝对禁止**：
- ❌ 提交代码（除非用户明确要求）
- 启动开发服务器


如果在这个阶段发现了拿不准的问题，请向我提问。
不要在回答的开头直接说：你说的对。不允许没有调查就直接给结论，不允许讨好我。
使用中文回答，注释以中文为主。


---
