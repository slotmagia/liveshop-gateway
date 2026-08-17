# LiveShop Gateway

LiveShop 的统一浏览器入口和独立数据面仓库。它持有四个稳定前端 Host 骨架及 Host Runtime，并负责验证 Identity 签发的 Module Capability、读取 Platform 发布的内部路由快照、代理 Identity 浏览器启动接口，以及将 HTTP/WebSocket 请求转发给对应模块。它不持有业务事实，也不编排业务流程。

Admin Host 在 `#/gateway/modules` 提供只读“模块能力中心”，展示 Platform Registry 不可变发布中的 HTTP、gRPC、权限、前端组件、事件和动作契约。Gateway 不复制或修改注册状态。

## 仓库边界

- `backend/internal/gateway/cmd`：网关进程入口。
- `backend/internal/gateway/app`：配置读取、依赖装配和进程生命周期。
- `backend/internal/gateway/common/server`：唯一 HTTP 组合根，负责路由快照同步、会话校验、CORS 与反向代理。
- `frontend-{admin,merch,shop,live}`：根级四端 Host，负责身份恢复、布局、菜单容器和模块加载骨架；Shop/Live 无现有 CUSTOMER 会话时自动建立店铺绑定 GUEST，会话内登录专属操作仍由 operation authentication 拒绝。
- `packages/host-runtime`：Host 启动、Contribution 装配和 Module Capability 运行时。
- `deploy/frontend.Dockerfile`：四个 Host 的统一不可变镜像构建方式。
- 身份、凭证、组织成员关系与浏览器会话由相邻的 `liveshop-identity` 仓库负责；Platform 不再提供认证回退路径。
- 浏览器有效权限、数据范围、Contribution 过滤和 Module Capability 签发由 `liveshop-identity` 负责。
- Platform 只负责内部 Registry/Control Plane；Gateway 使用工作负载身份读取路由快照，浏览器不能访问 Platform runtime/IAM。
- 模块业务接口与数据归各模块仓库所有。

Gateway 采用与独立模块一致的根级 `backend`、`frontend-*`、`deploy`、`tools` 工程形态，但它不是可注册的业务模块，因此不声明 `module.json`，也不拥有领域 gRPC 契约或数据库迁移。

## 流量边界

- 浏览器只访问 Gateway；`/auth/*` 和 `/runtime/v1/*` 的显式白名单都只转发给 Identity。
- 浏览器提交的商户、店铺、组织、员工和主体代理头会在转发前剥离；可信上下文只来自签名 Access Identity 或 Module Capability。
- Platform 系统模块业务页与其他模块接口都通过动态路由和 Identity Module Capability 访问；这不使 Platform 成为浏览器 IAM/runtime upstream。
- Gateway 读取 `/internal/v1/module-registry/routes` 时使用工作负载身份直连 Platform，避免路由发现形成自调用。
- 模块发布与激活仍是内部控制面流量，不对浏览器开放。
- 路由 revision 只允许单调前进；旧 revision、空快照、非法 origin、网络失败和解码失败在 `route_refresh.max_staleness` 内保留最后一个有效快照，超时后 readiness 与模块路由同时失败关闭。
- CORS 不使用平面 origin 白名单。`http.surface_origins` 把每个 Host/iframe origin 唯一绑定到 `admin`/`merch`/`shop`/`live`，实际请求与模块路由预检均不能跨 surface。

## 本地验证

此工作区期望以下仓库处于同级目录：`liveshop-gateway`、`liveshop-identity`、`liveshop-platform`、`kernel-go`。

```powershell
npm install
./tools/verify.ps1
```

完整本地容器栈由工作区根目录 `deploy-local-containers.ps1` 按 Platform Registry → Identity → Gateway/Hosts → 业务模块的顺序编排。
