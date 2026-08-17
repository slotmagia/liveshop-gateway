# LiveShop Gateway 工程规则

Gateway 不是业务模块，不建 `模块开发规范.md`。通用开发规范见仓库根 [`docs/开发规范.md`](../docs/开发规范.md)。Host 与数据面遵守其中第 1、2.3、5、7、8 章。禁止承载业务事实。Gateway 无 `module.json` 业务 operation，不接 `verify-naming.ps1`；Host 不得发明第三套业务 URL。Gateway 不评审其他模块的命名。

- 本仓库拥有无状态 LiveShop 数据面 Gateway、四个稳定前端 Host 外壳及 Host Runtime。
- 后端根目录为 `backend/internal/gateway`；`config` 拥有配置 schema 与校验，`app` 负责装配和生命周期，`common/server` 是唯一 HTTP 组合根，`cmd` 只包含进程入口。
- Gateway 进程配置只能来自 `-config` 指定的一份完整 YAML；禁止使用环境变量、隐式 overlay 或代码默认值。缺任何一项配置必须启动失败，不得回落到本机地址。`backend/cmd/archcheck` 会因为出现 `os.Getenv` 而失败。
- Gateway 不发布任何线协议，因此**不得建立 `protocol/` 目录**；它只依赖 Identity、Platform 和 Kernel 发布的契约模块。
- 浏览器可达的 Identity 启动路由白名单是 `internal/gateway/common/server/routes.go` 中的精确 method+path 列表，`dependency-policy.yaml` 的 `browser_routes` 必须与之逐条一致，由 archcheck 强制。Platform 没有浏览器代理路由。
- Host 位于仓库根目录 `frontend-admin`、`frontend-merch`、`frontend-shop` 和 `frontend-live`；禁止建立嵌套的 `frontend` 或 `apps/frontend` 工作区。
- 视觉契约只有 `@liveshop/design-tokens` 一个来源：两个后台 Host 导入 `console.css` 与 `tailwind.css`，商城和直播 Host 导入 `tokens.css`。Host Runtime 的样式表只描述外壳几何，禁止在其中写死颜色或为缺失的 token 写 `var(..., #fallback)`——那会让某个 Host 悄悄跑在第二套配色上。
- 两个后台 Host 用 React + Tailwind 渲染外壳，Tailwind 配置只能是 `presets: [@liveshop/design-tokens/tailwind-preset]` 加一份 `content`；在 `theme.extend` 里写颜色、圆角、阴影或字体等同于新建第二套配色，一律禁止。商城和直播 Host 保持原生 DOM，`@liveshop/host-runtime` 的默认入口因此不得引入 React——控制台代码只放在 `./console` 子入口下。
- 四个 Host 都必须从当前活动 Registry contribution 的 `title`/`description` 渲染菜单说明卡片；模块不得维护第二份页面级标题。原生页面同样必须声明 `description`，不能绕过这份契约。
- 管理型 contribution 必须采用“说明卡 → 独立查询卡 → 数据卡”的顺序；三张卡的左右边界和内容宽度必须一致，contribution 根节点不得添加水平内边距；iframe 必须通过 Host SDK 上报内容高度并由 Host 工作区统一滚动，禁止嵌套纵向滚动条；数据卡工具栏承载刷新、新增、导入、导出和批量操作，禁止独立页面工具栏。
- iframe 只是模块内容视口，必须保持透明且不得带圆角、阴影或白色表面；禁止把查询卡和数据卡包进一个额外的外层白色卡片。
- 查询卡操作组必须固定在第一行最右侧；多行查询默认展开并在搜索按钮前显示折叠/展开按钮，单行查询不显示该按钮；字段换行时操作组不得离开第一行或停在卡片中部。
- 查询卡普通字段必须各占一个等宽列；只有日期范围组件允许占两列，禁止为关键字、状态、编号等普通字段设置 `wide`、`span` 或自定义非等宽网格。
- 分页参数不得进入查询卡；分页列表统一在数据卡底部使用共享分页工具栏，表头与表格之间不得显示常驻统计条。
- 后台 Host 的 `html`、`body` 和挂载根节点必须锁定视口高度并禁止根文档滚动；纵向页面滚动只能由 `data-page-scroll-container` 承担。
- 模块产物（iframe、remote-esm）和原生页仍然是命令式挂载。React 侧只提供容器，不去 reconcile 模块自己的 DOM。
- Platform Registry 路由快照是模块端点能否路由的唯一事实源。
- Gateway 禁止拥有业务状态、IAM/RBAC 状态、模块注册状态或跨模块业务编排。
- Gateway Admin 能力中心只是 Platform Registry Manifest 的只读投影，禁止保存、探测或覆盖模块能力状态。
- 浏览器代码只能调用 Gateway。`/auth/*` 和 `/runtime/v1/*` 都是显式 Identity 启动路由；Platform 只作为 Identity/Gateway 使用工作负载身份访问的内部 Registry/Control Plane，`/internal/*` 永远不能暴露给浏览器。
- Host 禁止导入模块实现源码，只能通过 Host 协议加载已注册的不可变 artifact。
- Host 是后台 iframe 模态框与全视口遮罩的唯一承载者。共享模态框必须保持 Header / Body / Footer 三段结构，Header/Footer 固定且只有 Body 滚动；Host 必须覆盖 `100vw × 100dvh` 并在关闭、替换或 iframe 卸载时释放遮罩和滚动锁。
- Host 表单必须支持共享 `kind: 'checkbox-tree'` 层级多选协议；节点先经 Host Runtime 有界校验，再由 Design Tokens 渲染，只有叶子值参与提交。
- 每个模块代理请求都必须匹配已发布的 realm、surface、Registry revision、HTTP method 和 path，并通过 Identity 签发的 contribution-scoped Module Capability 校验。
- 路由刷新失败时必须保留最后一个有效快照；非法或空快照不能静默覆盖有效快照。
- 最后有效快照只能在必填的 `route_refresh.max_staleness` 窗口内使用；超时后 `/readyz` 和模块路由必须同时失败关闭。
- CORS 是明确的 Gateway 边界。每个配置 origin 必须唯一绑定到一个 surface，实际请求与模块路由预检都不能跨 surface；禁止恢复平面 allowlist。
- 可重试集成行为使用稳定 event/request ID；禁止对非幂等下游操作盲目重试。
- 直接演进当前唯一实现。除非存在明确外部兼容契约，否则禁止引入旧路由、feature flag 或 Gateway 多版本实现。
- 完成前必须运行 `tools/verify.ps1`，并通过 Platform Compose 重建本地 Gateway 容器。

## 领域语义保持

- Gateway 重构只能替换路由、验签和可信上下文建立方式，不能重新解释业务字段或删减旧项目的可观察行为。
- `appid`、`merchant_id`、`commercial_id`、`shop_id` 必须保持各自语义；禁止在 claims、请求上下文或代理头中把 `commercial_id` 改写为 `merchant_id`，也禁止用 `shop_id` 冒充 IAM department。
- 浏览器可以请求切换 `commercial_id`，但该值必须经 Identity 校验归属并进入签名 Access Identity 或 Identity Module Capability 后才能成为可信上下文；Gateway 不自行查库、推断或覆盖。
- surface 是交付和安全边界，不是业务模块边界。Gateway 不得根据 `admin`/`merch`/`shop`/`live` 为同一业务能力制造不同事实源。
- Kernel/Platform 的现有 claims 无法无损承载旧语义时，应演进统一契约和全部调用方，禁止用近似字段或长期兼容路由规避。
