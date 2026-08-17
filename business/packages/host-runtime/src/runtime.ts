/**
 * Everything a Host does that has nothing to do with rendering: registry
 * lookups, Identity-issued Module Capabilities, artifact integrity, iframe and remote mounting,
 * and the authentication handshake.
 *
 * The React console and the plain storefront shell both sit on this file, so a
 * change to the Host protocol is made once and cannot drift between surfaces.
 */
import { notify } from '@liveshop/design-tokens'
import {
  HOST_PROTOCOL,
  createHttpClient,
  type HostContext,
  type HostModuleUploadRequestMessage,
  type HostNotifyMessage,
  type RemoteModule,
  type RemoteModuleContext,
  type RuntimeContribution,
  type Surface,
} from '@liveshop/host-sdk'
import { disposeHostFormModalOwner, handleHostFormModalMessage, type HostModalOwner } from './hostModal'

interface RegistryResponse {
  code: number
  data: { revision: number; items: RuntimeContribution[] }
}

interface CapabilityResponse {
  code: number
  data: { token: string; expiresIn: number; permissions: string[]; tenant: { merchantId: number; shopId: number } }
}

interface ModuleCapabilityGrant {
  context: HostContext
  expiresIn: number
}

export interface HostConfig {
  surface: Surface
  title: string
  gatewayBaseUrl: string
  accessToken(): Promise<string>
  renewAccessToken?(): Promise<string>
  outlets: string[]
  nativePages?: NativeConsolePage[]
}

async function fetchWithAccessIdentity(config: HostConfig, input: string, init: RequestInit = {}): Promise<Response> {
  const request = async (token: string) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers })
  }
  const response = await request(await config.accessToken())
  if (response.status !== 401 || !config.renewAccessToken) return response
  return request(await config.renewAccessToken())
}

export interface NativePageContext {
  gatewayBaseUrl: string
  accessToken(): Promise<string>
}

export interface NativeConsolePage {
  id: string
  route: string
  title: string
  description: string
  sort: number
  render(container: HTMLElement, context: NativePageContext): Promise<void> | void
}

export type ContributionDisposer = () => void | Promise<void>

export type ConsoleSurface = Extract<Surface, 'admin' | 'merch'>

export interface ConsoleHostConfig extends Omit<HostConfig, 'surface' | 'title' | 'outlets'> {
  surface: ConsoleSurface
}

export interface AuthenticatedConsoleHostConfig extends Omit<ConsoleHostConfig, 'accessToken'> {
  realm: 'PLATFORM' | 'MERCHANT'
}

export interface AuthenticatedStorefrontHostConfig extends Omit<HostConfig, 'accessToken'> {
  surface: Extract<Surface, 'shop' | 'live'>
  realm: 'CUSTOMER'
  shopCode: string
}

export interface AuthenticatedHostConfig {
  surface: Surface
  gatewayBaseUrl: string
  realm: Realm
  shopCode?: string
}

export interface ConsoleSurfacePresentation {
  title: string
  subtitle: string
  outlets: string[]
}

export const consoleSurfaces: Record<ConsoleSurface, ConsoleSurfacePresentation> = {
  admin: {
    title: 'LiveShop 管理后台',
    subtitle: '平台管理控制台',
    outlets: ['admin.dashboard.widgets'],
  },
  merch: {
    title: 'LiveShop 商家后台',
    subtitle: '商户运营控制台',
    outlets: ['merch.dashboard.widgets'],
  },
}

const events = new EventTarget()

export const REGISTRY_REFRESH_INTERVAL_MS = 5_000
export const MAX_IFRAME_CONTENT_HEIGHT = 100_000

export function normalizeIframeContentHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_IFRAME_CONTENT_HEIGHT) return undefined
  return Math.ceil(value)
}

/**
 * Keeps a logged-in Host converged with releases activated after the Host was
 * opened. Registry publication and browser login are independent, so reading
 * contributions only once would leave the navigation pinned to an obsolete
 * snapshot until the whole page was reloaded.
 */
export function subscribeRegistryRefresh(
  refresh: () => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = REGISTRY_REFRESH_INTERVAL_MS,
): () => void {
  let stopped = false
  let inFlight = false

  const run = () => {
    if (stopped || inFlight) return
    inFlight = true
    void refresh()
      .catch(onError)
      .finally(() => { inFlight = false })
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') run()
  }

  const timer = window.setInterval(run, intervalMs)
  window.addEventListener('focus', run)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener('focus', run)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

async function getCapability(config: HostConfig, item: RuntimeContribution): Promise<ModuleCapabilityGrant> {
  let response: Response
  try {
    response = await fetchWithAccessIdentity(config, config.gatewayBaseUrl + '/runtime/v1/module-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Liveshop-Surface': config.surface },
      body: JSON.stringify({
        moduleId: item.moduleId,
        moduleVersion: item.moduleVersion,
        contributionId: item.contribution.id,
        surface: config.surface,
      }),
    })
  } catch (error) {
    throw new Error(`module capability request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const body = await response.json() as CapabilityResponse & { message?: string }
  if (!response.ok || body.code !== 0) throw new Error(body.message || `cannot obtain module capability (HTTP ${response.status})`)
  return {
    expiresIn: body.data.expiresIn,
    context: {
      protocol: HOST_PROTOCOL,
      surface: config.surface,
      moduleId: item.moduleId,
      moduleVersion: item.moduleVersion,
      contributionId: item.contribution.id,
      moduleToken: body.data.token,
      gatewayBaseUrl: config.gatewayBaseUrl,
      locale: navigator.language || 'en-US',
      permissions: body.data.permissions,
      tenant: body.data.tenant,
      theme: { mode: 'light' },
    },
  }
}

interface IframeMount {
  dispose: ContributionDisposer
  updateContext(): void
}

async function contributionByID(config: HostConfig, moduleId: string, contributionId: string): Promise<RuntimeContribution> {
  const response = await fetchWithAccessIdentity(config, config.gatewayBaseUrl + `/runtime/v1/contributions?surface=${encodeURIComponent(config.surface)}`, {
    headers: { 'X-Liveshop-Surface': config.surface },
  })
  const body = await response.json() as RegistryResponse
  if (!response.ok || body.code !== 0) throw new Error('cannot read authorized module actions')
  const item = body.data.items.find(candidate => candidate.moduleId === moduleId && candidate.contribution.id === contributionId)
  if (!item || item.contribution.kind !== 'action') throw new Error('module action is unavailable or forbidden')
  return item
}

async function performModuleUpload(config: HostConfig, message: HostModuleUploadRequestMessage): Promise<{ status: number; data: unknown }> {
  if (!message.path.startsWith('/') || message.file.size <= 0 || message.file.size > 10 * 1024 * 1024) throw new Error('invalid module upload request')
  const action = await contributionByID(config, message.moduleId, message.contributionId)
  const grant = await getCapability(config, action)
  const form = new FormData()
  form.append('file', message.file, message.file.name)
  for (const [name, value] of Object.entries(message.fields || {})) form.append(name, value)
  const response = await fetch(config.gatewayBaseUrl + message.path, {
    method: 'POST', body: form,
    headers: { Authorization: `Bearer ${grant.context.moduleToken}`, 'X-Liveshop-Surface': config.surface },
  })
  const body = await response.json().catch(() => null) as { code?: number; message?: string; data?: unknown } | null
  if (!response.ok || body?.code !== 0) throw new Error(body?.message || `module upload failed with HTTP ${response.status}`)
  return { status: response.status, data: body.data }
}

export interface IframeHostOverlayState {
  requestId: string
  contentHeight: string
}

export function openIframeHostOverlay(
  iframe: HTMLIFrameElement,
  requestId: string,
  current?: IframeHostOverlayState,
): IframeHostOverlayState {
  const state = { requestId, contentHeight: current?.contentHeight ?? iframe.style.height }
  iframe.style.height = '100dvh'
  iframe.classList.add('ls-host__frame--overlay')
  iframe.ownerDocument.documentElement.classList.add('ls-host--overlay-open')
  return state
}

export function updateIframeContentHeight(
  iframe: HTMLIFrameElement,
  overlay: IframeHostOverlayState | undefined,
  height: string,
): void {
  if (overlay) overlay.contentHeight = height
  else iframe.style.height = height
}

export function closeIframeHostOverlay(
  iframe: HTMLIFrameElement,
  overlay: IframeHostOverlayState | undefined,
  requestId: string,
): IframeHostOverlayState | undefined {
  if (!overlay || overlay.requestId !== requestId) return overlay
  iframe.style.height = overlay.contentHeight
  iframe.classList.remove('ls-host__frame--overlay')
  iframe.ownerDocument.documentElement.classList.remove('ls-host--overlay-open')
  return undefined
}

async function mountIframe(
  container: HTMLElement,
  item: RuntimeContribution,
  context: HostContext,
  config: HostConfig,
  onReady?: () => void,
): Promise<IframeMount> {
  const iframe = document.createElement('iframe')
  iframe.className = 'ls-host__frame'
  // Always remount against a fresh document URL. Browsers (and Host soft
  // navigations) otherwise keep the previous iframe shell, so a redeployed
  // contribution at the same entry origin looks "unchanged".
  const entry = new URL(item.contribution.artifact.entry)
  entry.searchParams.set('v', item.contribution.artifact.version)
  entry.searchParams.set('t', String(Date.now()))
  iframe.src = entry.toString()
  iframe.title = item.contribution.title
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin')
  // Module artifacts are cross-origin. Without this Permissions Policy
  // delegation, navigator.clipboard.writeText() in the iframe is blocked.
  iframe.setAttribute('allow', 'clipboard-write')
  iframe.referrerPolicy = 'strict-origin'
  const origin = entry.origin
  let ready = false
  let loadSettled = false
  let overlay: IframeHostOverlayState | undefined
  const updateContext = () => {
    if (ready) iframe.contentWindow?.postMessage({ type: 'LIVESHOP_HOST_CONTEXT', context }, origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return
    if (event.data?.protocol !== HOST_PROTOCOL) return
    if (event.data?.type === 'LIVESHOP_MODULE_READY') {
      if (ready) return
      ready = true
      updateContext()
      onReady?.()
      return
    }
    if (event.data?.type === 'LIVESHOP_MODULE_SIZE') {
      const height = normalizeIframeContentHeight(event.data.height)
      if (height !== undefined) updateIframeContentHeight(iframe, overlay, `${height}px`)
      return
    }
    if (event.data?.type === 'LIVESHOP_HOST_OVERLAY_OPEN' && typeof event.data.requestId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(event.data.requestId)) {
      overlay = openIframeHostOverlay(iframe, event.data.requestId, overlay)
      return
    }
    if (event.data?.type === 'LIVESHOP_HOST_OVERLAY_CLOSE') {
      overlay = closeIframeHostOverlay(iframe, overlay, event.data.requestId)
      return
    }
    if (event.data?.type === 'LIVESHOP_HOST_NOTIFY') {
      handleHostNotifyMessage(event.data)
      return
    }
    if (event.data?.type === 'LIVESHOP_HOST_MODULE_UPLOAD' && typeof event.data.requestId === 'string') {
      const message = event.data as HostModuleUploadRequestMessage
      void performModuleUpload(config, message).then(result => {
        ;(event.source as WindowProxy).postMessage({ type: 'LIVESHOP_HOST_MODULE_UPLOAD_RESULT', protocol: HOST_PROTOCOL, requestId: message.requestId, ok: true, status: result.status, data: result.data }, origin)
      }).catch(error => {
        ;(event.source as WindowProxy).postMessage({ type: 'LIVESHOP_HOST_MODULE_UPLOAD_RESULT', protocol: HOST_PROTOCOL, requestId: message.requestId, ok: false, status: 0, message: error instanceof Error ? error.message : String(error) }, origin)
      })
      return
    }
    handleHostFormModalMessage(event.source as HostModalOwner, origin, event.data)
  }
  const settleAfterDocumentLoad = () => {
    if (loadSettled) return
    loadSettled = true
    onReady?.()
  }
  // A module can announce protocol readiness before fonts, stylesheets and the
  // iframe document load boundary have settled. Chromium may scroll the Host
  // to the iframe at that later boundary, so both signals participate in the
  // page-position invariant (at most once each).
  iframe.addEventListener('load', settleAfterDocumentLoad)
  window.addEventListener('message', receive)
  container.replaceChildren(iframe)
  const owner = iframe.contentWindow as HostModalOwner | null
  return {
    updateContext,
    dispose: () => {
      iframe.removeEventListener('load', settleAfterDocumentLoad)
      window.removeEventListener('message', receive)
      if (owner) disposeHostFormModalOwner(owner)
      if (overlay) overlay = closeIframeHostOverlay(iframe, overlay, overlay.requestId)
      iframe.remove()
    },
  }
}

export const MAX_HOST_NOTIFY_TEXT = 500

export function handleHostNotifyMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<HostNotifyMessage>
  if (message.type !== 'LIVESHOP_HOST_NOTIFY' || message.protocol !== HOST_PROTOCOL) return false
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  if (!text || text.length > MAX_HOST_NOTIFY_TEXT) return false
  const tone = message.tone === 'success' || message.tone === 'warning' || message.tone === 'danger' || message.tone === 'info'
    ? message.tone
    : 'info'
  notify(text, tone)
  return true
}

export const MODULE_CAPABILITY_REFRESH_LEEWAY_MS = 60_000
export const MODULE_CAPABILITY_REFRESH_RETRY_MS = 5_000

function moduleCapabilityRefreshDelay(expiresIn: number, leewayMs: number): number {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return MODULE_CAPABILITY_REFRESH_RETRY_MS
  return Math.max(1_000, expiresIn * 1_000 - leewayMs)
}

/**
 * Renews a short-lived contribution capability before it expires. Failed
 * renewals retain the current grant and retry with a bounded delay; scope is
 * always taken from a freshly authorized Identity response.
 */
export function subscribeModuleCapabilityRefresh(
  refresh: () => Promise<ModuleCapabilityGrant>,
  onGrant: (grant: ModuleCapabilityGrant) => void,
  onError: (error: unknown) => void,
  expiresIn: number,
  leewayMs = MODULE_CAPABILITY_REFRESH_LEEWAY_MS,
  retryMs = MODULE_CAPABILITY_REFRESH_RETRY_MS,
): ContributionDisposer {
  let stopped = false
  let timer = 0

  const schedule = (delayMs: number) => {
    if (!stopped) timer = window.setTimeout(run, delayMs)
  }
  const run = () => {
    if (stopped) return
    void refresh()
      .then((grant) => {
        if (stopped) return
        onGrant(grant)
        schedule(moduleCapabilityRefreshDelay(grant.expiresIn, leewayMs))
      })
      .catch((error) => {
        if (stopped) return
        onError(error)
        schedule(retryMs)
      })
  }

  schedule(moduleCapabilityRefreshDelay(expiresIn, leewayMs))
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}

async function verifyRemoteSource(entry: string, integrity: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(entry)
  } catch (error) {
    throw new Error(`artifact request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`cannot load remote module: ${response.status}`)
  const source = await response.text()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (`sha256:${actual}` !== integrity) throw new Error('remote module integrity mismatch')
  return source
}

async function mountRemote(
  container: HTMLElement,
  item: RuntimeContribution,
  context: HostContext,
  onReady?: () => void,
): Promise<ContributionDisposer> {
  const source = await verifyRemoteSource(item.contribution.artifact.entry, item.contribution.artifact.integrity)
  const verifiedURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  let namespace: Record<string, unknown>
  try {
    namespace = await import(/* @vite-ignore */ verifiedURL) as Record<string, unknown>
  } finally {
    URL.revokeObjectURL(verifiedURL)
  }
  const exported = namespace[item.contribution.artifact.exportName || 'default'] as RemoteModule | undefined
  if (!exported?.mount) throw new Error(`missing remote export ${item.contribution.artifact.exportName}`)
  const remoteContext = Object.assign(context, {
    api: createHttpClient(context),
    navigate(path: string) { location.hash = path },
    events,
  }) as RemoteModuleContext
  await exported.mount(container, remoteContext)
  onReady?.()
  return async () => {
    await exported.unmount?.(container)
    container.replaceChildren()
  }
}

export async function mountContribution(
  container: HTMLElement,
  config: HostConfig,
  item: RuntimeContribution,
  onReady?: () => void,
): Promise<ContributionDisposer> {
  try {
    const initial = await getCapability(config, item)
    const context = initial.context
    let updateContext = () => {}
    let disposeContribution: ContributionDisposer
    if (item.contribution.artifact.type === 'iframe') {
      const mounted = await mountIframe(container, item, context, config, onReady)
      updateContext = mounted.updateContext
      disposeContribution = mounted.dispose
    } else {
      disposeContribution = await mountRemote(container, item, context, onReady)
    }
    const disposeRefresh = subscribeModuleCapabilityRefresh(
      () => getCapability(config, item),
      (grant) => {
        Object.assign(context, grant.context)
        updateContext()
      },
      (error) => console.warn(`module ${item.moduleId} session refresh failed`, error),
      initial.expiresIn,
    )
    return async () => {
      await disposeRefresh()
      await disposeContribution()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = document.createElement('div')
    failure.className = 'ls-host__error'
    failure.textContent = `Module ${item.moduleId} failed: ${message}`
    container.replaceChildren(failure)
    onReady?.()
    return () => failure.remove()
  }
}

export interface HostPage {
  id: string
  route: string
  title: string
  description: string
  icon?: string
  sort: number
  navigation?: {
    groupId: string
    groupTitle: string
    groupIcon?: string
    groupSort: number
  }
  contribution?: RuntimeContribution
  native?: NativeConsolePage
}

export interface HostRegistry {
  revision: number
  pages: HostPage[]
  byOutlet: Map<string, RuntimeContribution[]>
}

/**
 * Registry revisions are the Platform-owned ordering for immutable release
 * snapshots. Keep the current object for an equal (or stale) poll response so
 * React consumers do not interpret a no-op refresh as a new contribution and
 * tear down its iframe.
 */
export function reconcileRegistryRefresh(current: HostRegistry, refreshed: HostRegistry): HostRegistry {
  return refreshed.revision > current.revision ? refreshed : current
}

/** Reads the registry once and splits it into routable pages and outlet slots. */
export async function loadRegistry(config: HostConfig): Promise<HostRegistry> {
  const response = await fetchWithAccessIdentity(config, `${config.gatewayBaseUrl}/runtime/v1/contributions?surface=${config.surface}`, {
    headers: { 'X-Liveshop-Surface': config.surface },
  })
  const body = await response.json() as RegistryResponse
  if (!response.ok || body.code !== 0) throw new Error('cannot load module contributions')
  const pages: HostPage[] = [
    ...(config.nativePages || []).map((page) => ({ id: page.id, route: page.route, title: page.title, description: page.description, sort: page.sort, native: page })),
    ...body.data.items.filter((item) => item.contribution.kind === 'page').map((item) => ({
      id: item.contribution.id,
      route: item.contribution.route || '',
      title: item.contribution.title,
      description: item.contribution.description,
      icon: item.contribution.icon,
      sort: item.contribution.sort || 0,
      navigation: item.contribution.navigation,
      contribution: item,
    })),
  ].sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id))
  const byOutlet = new Map<string, RuntimeContribution[]>()
  for (const item of body.data.items.filter((candidate) => candidate.contribution.kind !== 'page')) {
    const outlet = item.contribution.outlet || ''
    byOutlet.set(outlet, [...(byOutlet.get(outlet) || []), item])
  }
  return { revision: body.data.revision, pages, byOutlet }
}

export interface Principal {
  realm: string
  principalType: string
  subject: string
  username: string
  sessionId?: string
  organizationId?: number
  merchantId?: number
  shopId?: number
  identityVersion?: number
  contextVersion?: number
}

interface LoginResponse {
  code: number
  data: { accessToken: string; expiresIn: number; principal: Principal }
}

export interface Session {
  accessToken: string
  principal: Principal
}

export type Realm = 'PLATFORM' | 'MERCHANT' | 'CUSTOMER'

export function tokenStorageKey(realm: Realm): string {
  return `liveshop.access_token.${realm.toLowerCase()}`
}

export function storedAccessToken(realm: Realm): string {
  return sessionStorage.getItem(tokenStorageKey(realm)) || ''
}

export function clearAccessToken(realm: Realm): void {
  sessionStorage.removeItem(tokenStorageKey(realm))
}

export async function refreshAccessToken(config: AuthenticatedHostConfig): Promise<Session> {
  const response = await fetch(config.gatewayBaseUrl + '/auth/refresh', {
    method: 'POST', credentials: 'include', headers: { 'X-Liveshop-Surface': config.surface },
  })
  if (!response.ok) throw new Error('authenticated session is unavailable')
  const body = await response.json() as LoginResponse
  if (body.code !== 0 || body.data.principal.realm !== config.realm) throw new Error('authenticated realm does not match this console')
  sessionStorage.setItem(tokenStorageKey(config.realm), body.data.accessToken)
  return { accessToken: body.data.accessToken, principal: body.data.principal }
}

export async function guestAccessToken(config: AuthenticatedStorefrontHostConfig): Promise<Session> {
	const response = await fetch(config.gatewayBaseUrl + '/auth/guest', {
		method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Liveshop-Surface': config.surface },
		body: JSON.stringify({ shopCode: config.shopCode }),
	})
	const body = await response.json() as LoginResponse & { message?: string }
	if (!response.ok || body.code !== 0) throw new Error(body.message || '游客会话创建失败')
	if (body.data.principal.realm !== 'CUSTOMER' || body.data.principal.principalType !== 'GUEST') throw new Error('游客身份与当前店铺不匹配')
	sessionStorage.setItem(tokenStorageKey(config.realm), body.data.accessToken)
	return { accessToken: body.data.accessToken, principal: body.data.principal }
}

export interface Credentials {
  username: string
  password: string
}

export async function login(config: AuthenticatedHostConfig, credentials: Credentials): Promise<Session> {
  const loginBody: Record<string, unknown> = { realm: config.realm, username: credentials.username, password: credentials.password }
  if (config.shopCode) loginBody.shopCode = config.shopCode
  const response = await fetch(config.gatewayBaseUrl + '/auth/login', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Liveshop-Surface': config.surface },
    body: JSON.stringify(loginBody),
  })
  const body = await response.json() as LoginResponse & { message?: string }
  if (!response.ok || body.code !== 0) throw new Error(body.message || '登录失败')
  sessionStorage.setItem(tokenStorageKey(config.realm), body.data.accessToken)
  return { accessToken: body.data.accessToken, principal: body.data.principal }
}

export async function logout(config: AuthenticatedHostConfig): Promise<void> {
  clearAccessToken(config.realm)
  try {
    await fetch(config.gatewayBaseUrl + '/auth/logout', {
      method: 'POST', credentials: 'include', headers: { 'X-Liveshop-Surface': config.surface },
    })
  } catch {
    // A dropped logout call still ends the session in this tab.
  }
}

export type { RuntimeContribution, Surface }
