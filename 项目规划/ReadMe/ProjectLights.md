# phResume - 所见即所得简历编辑与异步 PDF 生成系统

## 1. 技术栈

### 后端 (Backend)
- **语言**: Go (Golang) 1.25+
- **Web 框架**: Gin (API 服务)
- **数据库**: PostgreSQL (存储用户、简历、模板数据)
- **ORM**: GORM (数据持久化与迁移)
- **缓存与消息队列**: Redis (用于 Asynq 任务队列及 Pub/Sub 实时通知)
- **对象存储**: MinIO (兼容 S3，存储简历 PDF、图片资产)
- **异步任务**: Asynq (处理耗时任务，如 PDF 生成)
- **配置管理**: Viper (支持环境变量、配置文件读取)
- **认证**: JWT (RS256 非对称加密) + Argon2 (密码哈希)
- **PDF 生成**: go-rod (无头浏览器控制，实现高质量渲染)
- **文件扫描**: ClamAV (集成 ClamAV 进行文件上传安全扫描)
- **可观测性**: Prometheus (指标监控), Grafana (可视化), Loki (日志聚合), Promtail (日志采集)

### 前端 (Frontend)
- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **UI 库**: Tailwind CSS v4, HeroUI, Lucide React (图标)
- **状态管理**: React Context (Auth, Editor State)
- **拖拽布局**: react-grid-layout, react-resizable (实现自由画布编辑)
- **富文本编辑**: Lexical (Facebook 开源富文本编辑器)
- **动画**: Framer Motion
- **HTTP 客户端**: Fetch API (封装 hooks)

### 基础设施与运维 (Infrastructure)
- **容器化**: Docker, Docker Compose (全栈服务编排)
- **反向代理**: Nginx (处理前端静态资源及 API 转发)
- **开发工具**: Air (Go 热重载), ESLint, Prettier

## 2. 项目难点 (Challenges)

1.  **高保真 PDF 渲染 (High-Fidelity PDF Generation)**:
    -   **问题**: 传统的后端 HTML-to-PDF 库往往无法完美还原前端复杂的 CSS 布局（如 Grid、Flexbox、自定义字体）。
    -   **解决**: 采用 `go-rod` 控制无头 Chromium 浏览器，直接访问前端的打印专用页面 (`/print/:id`)。通过注入打印专用 CSS (`@media print`) 和等待页面渲染完成的机制，确保生成的 PDF 与用户在编辑器中看到的效果像素级一致。

2.  **实时异步任务反馈 (Real-time Asynchronous Feedback)**:
    -   **问题**: PDF 生成是耗时操作，用户点击生成后需要知道任务进度，而不是一直转圈等待。
    -   **解决**: 使用 `Asynq` 将 PDF 生成任务推入 Redis 队列异步处理。Worker 处理完成后，通过 Redis Pub/Sub 广播消息，API 服务通过 WebSocket 实时推送任务状态（Pending -> Completed）给前端，实现无刷新体验。

3.  **复杂的可视化编辑器 (Complex Visual Editor)**:
    -   **问题**: 实现一个支持拖拽、缩放、自由布局且能适应 A4 纸张比例的编辑器。
    -   **解决**: 基于 `react-grid-layout` 构建 24 列网格系统，结合 `react-resizable` 实现模块的自由拖拽与调整大小。计算 A4 纸张宽高比，严格限制画布尺寸，确保编辑视图与打印视图一致。设计了撤销/重做 (Undo/Redo) 历史栈机制，提升用户体验。

4.  **安全的文件上传与访问 (Secure File Handling)**:
    -   **问题**: 用户上传的头像、PDF 等文件需要安全存储，且防止恶意文件上传。
    -   **解决**: 集成 `ClamAV` 在文件上传时进行病毒扫描。使用 MinIO 存储文件，所有文件默认私有，下载时动态生成预签名 URL (Presigned URL)，严格控制访问权限与有效期。

## 3. 项目亮点 (Highlights)

1.  **所见即所得 (WYSIWYG) 的极致体验**:
    -   从编辑到生成的全链路一致性。前端编辑器与后端生成引擎共用同一套渲染逻辑（Next.js 页面），消除了“预览与下载不符”的常见痛点。

2.  **微服务架构雏形与分离设计**:
    -   API 服务与 Worker 服务分离。API 负责轻量级的请求响应，Worker 负责资源密集型的 PDF 渲染任务。两者通过 Redis 解耦，具备良好的水平扩展能力。

3.  **完善的可观测性体系 (Observability)**:
    -   内置 Prometheus 监控指标（API 请求延迟、Worker 队列深度、任务成功率）。
    -   集成 Loki + Promtail 进行日志聚合，Grafana 统一展示大盘。这在个人项目中较为少见，体现了对生产环境运维的思考。

4.  **企业级安全实践**:
    -   **认证**: 采用 RS256 非对称加密签发 JWT，安全性高于常见的 HS256。
    -   **密码学**: 使用 Argon2id 算法存储密码哈希，抗 GPU 破解。
    -   **文件安全**: 上传文件强制病毒扫描，对象存储采用预签名访问机制，无公共读权限。

5.  **现代化的技术选型**:
    -   紧跟技术潮流，使用了 Go 1.25, Next.js 16, Tailwind CSS v4, GORM, Asynq 等前沿且成熟的技术栈，代码风格规范，结构清晰。
