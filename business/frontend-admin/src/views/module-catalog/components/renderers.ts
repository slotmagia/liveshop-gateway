import type { CapabilityField, CapabilityRelease, Contribution, GRPCMethod, HTTPOperation, ModuleCatalog } from '../types'
import { badgeClass, ui } from '@liveshop/design-tokens'

const escapeHTML = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
const tags = (values: string[]) => values.map((value) => `<code class="cap-tag">${escapeHTML(value)}</code>`).join('')

function fields(items: CapabilityField[], empty = '无显式参数'): string {
  if (!items.length) return `<p class="cap-empty">${empty}</p>`
  return `<div class="cap-fields">${items.map((field) => `<div><code>${escapeHTML(field.name)}</code><span>${escapeHTML(field.type)}${field.location ? ` · ${escapeHTML(field.location)}` : ''}${field.required ? ' · 必填' : ''}</span><p>${escapeHTML(field.description)}</p></div>`).join('')}</div>`
}

function httpOperation(operation: HTTPOperation): string {
  return `<details class="cap-contract ${ui.card}"><summary><span class="cap-method cap-method--${escapeHTML(operation.method.toLowerCase())}">${escapeHTML(operation.method)}</span><code>${escapeHTML(operation.path)}</code><strong>${escapeHTML(operation.summary)}</strong></summary><div class="cap-contract__body"><p>${escapeHTML(operation.description)}</p><div class="cap-meta"><span>认证：${escapeHTML(operation.authentication)}</span><span>幂等：${escapeHTML(operation.idempotency)}</span><span>ID：<code>${escapeHTML(operation.id)}</code></span></div><h4>所需权限</h4><div>${tags(operation.requiredPermissions)}</div><h4>请求参数</h4>${fields(operation.requestFields)}<h4>响应</h4>${operation.responses.map((response) => `<section class="cap-response"><strong>HTTP ${response.status}</strong><span>${escapeHTML(response.description)}</span>${fields(response.fields, '空响应体')}</section>`).join('')}</div></details>`
}

function grpcMethod(method: GRPCMethod): string {
  return `<details class="cap-contract ${ui.card}"><summary><span class="cap-method cap-method--grpc">gRPC</span><code>${escapeHTML(method.fullMethod)}</code><strong>${escapeHTML(method.summary)}</strong></summary><div class="cap-contract__body"><p>${escapeHTML(method.description)}</p><div class="cap-meta"><span>${escapeHTML(method.invocation)}</span><span>幂等：${escapeHTML(method.idempotency)}</span><span>建议 deadline：${method.recommendedDeadlineMs}ms</span></div><h4>所需权限</h4><div>${tags(method.requiredPermissions)}</div><h4>Request</h4>${fields(method.requestFields)}<h4>Response</h4>${fields(method.responseFields, '空响应')}</div></details>`
}

function frontendContribution(item: Contribution): string {
  const location = item.route || item.outlet || '-'
  return `<details class="cap-contract ${ui.card}"><summary><span class="cap-method cap-method--ui">${escapeHTML(item.kind)}</span><code>${escapeHTML(item.frontend.component)}</code><strong>${escapeHTML(item.title)}</strong></summary><div class="cap-contract__body"><p>${escapeHTML(item.description)}</p><div class="cap-meta"><span>surface：${escapeHTML(item.surface)}</span><span>挂载点：${escapeHTML(location)}</span><span>artifact：${escapeHTML(item.artifact.type)}</span></div><h4>Props</h4>${fields(item.frontend.props)}<h4>Events</h4>${item.frontend.events.length ? item.frontend.events.map((event) => `<section class="cap-callable"><code>${escapeHTML(event.name)}</code><span>${escapeHTML(event.description)}</span>${fields(event.payload, '无 payload')}</section>`).join('') : '<p class="cap-empty">无公开事件</p>'}<h4>可调用动作 / 按钮</h4>${item.frontend.actions.length ? item.frontend.actions.map((action) => `<section class="cap-callable"><strong>${escapeHTML(action.label)}</strong><code>${escapeHTML(action.id)}</code><p>${escapeHTML(action.description)}</p><div class="cap-meta"><span>${escapeHTML(action.invocation)}</span><span>目标：<code>${escapeHTML(action.target)}</code></span></div>${fields(action.parameters)}</section>`).join('') : '<p class="cap-empty">无公开动作</p>'}</div></details>`
}

export function renderModuleList(items: ModuleCatalog[], selectedID: string, query: string): string {
  const normalized = query.trim().toLowerCase()
  const visible = items.filter((item) => !normalized || `${item.id} ${item.name}`.toLowerCase().includes(normalized))
  return visible.map((item) => {
    const release = item.releases.find((candidate) => candidate.active && candidate.version === item.activeVersion)
    const httpCount = release?.backend.httpRoutes.reduce((total, route) => total + route.operations.length, 0) || 0
    const grpcCount = release?.backend.grpc?.methods.length || 0
    const uiCount = release?.contributions.length || 0
    return `<button type="button" class="cap-module" data-module-id="${escapeHTML(item.id)}" data-active="${item.id === selectedID}"><span><strong>${escapeHTML(item.name)}</strong><code>${escapeHTML(item.id)}</code></span><small>${httpCount} HTTP · ${grpcCount} gRPC · ${uiCount} UI</small></button>`
  }).join('') || '<p class="cap-empty">没有匹配的模块</p>'
}

export function renderRelease(module: ModuleCatalog, release: CapabilityRelease, revision: number): string {
  const http = release.backend.httpRoutes.flatMap((route) => route.operations)
  const grpc = release.backend.grpc
  return `<div class="cap-detail__heading"><div><span class="cap-eyebrow">ACTIVE MODULE CAPABILITY CONTRACT</span><h1>${escapeHTML(module.name)}</h1><p><code>${escapeHTML(module.id)}</code> · registry revision ${revision}</p></div><div class="cap-release"><span>活动版本 <code>${escapeHTML(release.version)}</code></span><span class="${badgeClass('success')}">已激活</span></div></div><section class="cap-summary ${ui.statGrid}"><div class="${ui.stat}"><span>Service</span><strong>${escapeHTML(release.backend.service)}</strong></div><div class="${ui.stat}"><span>HTTP Origin</span><code>${escapeHTML(release.backend.origin)}</code></div><div class="${ui.stat}"><span>Digest</span><code title="${escapeHTML(release.digest)}">${escapeHTML(release.digest.slice(0, 24))}…</code></div><div class="${ui.stat}"><span>能力总览</span><strong>${http.length} HTTP · ${grpc?.methods.length || 0} gRPC · ${release.contributions.length} UI</strong></div></section><section class="cap-section"><div class="cap-section__title"><div><span>01</span><h2>HTTP 接口</h2></div><p>浏览器模块通过 Gateway + Identity Module Capability 调用</p></div>${http.map(httpOperation).join('') || '<p class="cap-empty">未声明 HTTP 能力</p>'}</section><section class="cap-section"><div class="cap-section__title"><div><span>02</span><h2>gRPC 接口</h2></div><p>${grpc ? `${escapeHTML(grpc.endpoint)} · ${escapeHTML(grpc.transportSecurity)} · contract ${escapeHTML(grpc.contractVersion)}` : '未提供服务间 gRPC'}</p></div>${grpc?.methods.map(grpcMethod).join('') || '<p class="cap-empty">未声明 gRPC 能力</p>'}</section><section class="cap-section"><div class="cap-section__title"><div><span>03</span><h2>前端组件与动作</h2></div><p>组件、插槽、事件及可被 Host/Agent 调用的动作</p></div>${release.contributions.map(frontendContribution).join('') || '<p class="cap-empty">未声明前端能力</p>'}</section><section class="cap-section"><div class="cap-section__title"><div><span>04</span><h2>权限与接入</h2></div><p>调用方必须通过 IAM 或工作负载身份获得最小权限</p></div><div class="cap-permissions">${release.permissions.map((permission) => `<article class="${ui.card}"><code>${escapeHTML(permission.code)}</code><strong>${escapeHTML(permission.name)}</strong><p>${escapeHTML(permission.description || `${permission.resource}.${permission.action}`)}</p></article>`).join('')}</div><div class="cap-agent"><strong>内部活动能力事实源</strong><code>gRPC PlatformRegistryService/GetActiveCapabilitySnapshot</code><p>仅 Identity 工作负载以 mTLS + Ed25519 调用，并申请 <code>platform.registry.active-capabilities.read</code>。不存在对浏览器或通用 Agent 开放的内部 capability HTTP API；浏览器管理台只调用 Identity 的 <code>GET /runtime/v1/module-catalog</code>。</p></div></section>`
}
