/**
 * The framework-neutral Host entry, used by the storefront and live surfaces.
 *
 * The two back-office consoles render with React and live behind
 * `@liveshop/host-runtime/console`, so a C-end bundle never pays for the
 * console shell. Both entries share `runtime.ts`.
 */
import {
  clearAccessToken,
  guestAccessToken,
  loadRegistry,
  login,
  mountContribution,
  refreshAccessToken,
  storedAccessToken,
  type AuthenticatedStorefrontHostConfig,
  type ContributionDisposer,
  type HostConfig,
  type NativeConsolePage,
} from './runtime'
import { persistLocale, resolveHostLocale, shopLocaleMeta } from './locale'

interface HostShell {
  nav: HTMLElement
  summary: HTMLElement
  summaryTitle: HTMLElement
  summaryDescription: HTMLElement
  page: HTMLElement
  outletRoot: HTMLElement
}

const storefrontNavigation = [
  { route: '/', label: '首页', icon: 'home' },
  { route: '/products', label: '分类', icon: 'bag' },
  { route: '/live', label: '直播', icon: 'play', featured: true },
  { route: '/cart', label: '购物车', icon: 'cart' },
  { route: '/profile', label: '我的', icon: 'user' },
] as const

type StorefrontIcon = 'home' | 'bag' | 'play' | 'cart' | 'user' | 'search' | 'globe' | 'back'

function storefrontIcon(name: StorefrontIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const shapes: Record<StorefrontIcon, Array<[string, Record<string, string>]>> = {
    home: [['path', { d: 'm3 11 9-8 9 8' }], ['path', { d: 'M5 10v10h14V10' }], ['path', { d: 'M9 20v-6h6v6' }]],
    bag: [['path', { d: 'M6 8h12l1 13H5L6 8Z' }], ['path', { d: 'M9 8V6a3 3 0 0 1 6 0v2' }]],
    play: [['path', { d: 'm9 7 8 5-8 5V7Z', fill: 'currentColor', stroke: 'none' }]],
    cart: [['circle', { cx: '9', cy: '20', r: '1' }], ['circle', { cx: '18', cy: '20', r: '1' }], ['path', { d: 'M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6' }]],
    user: [['circle', { cx: '12', cy: '8', r: '4' }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
    search: [['circle', { cx: '11', cy: '11', r: '7' }], ['path', { d: 'm20 20-4-4' }]],
    globe: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }]],
    back: [['path', { d: 'm15 18-6-6 6-6' }]],
  }
  for (const [tag, attributes] of shapes[name]) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value)
    svg.append(shape)
  }
  return svg
}

export function storefrontSection(path: string): string {
  if (path === '/' || path === '') return '/'
  if (path === '/products' || path === '/search' || path === '/product/detail' || path.startsWith('/coupons')) return '/products'
  if (path === '/live' || path.startsWith('/live/')) return '/live'
  if (path === '/cart' || path === '/checkout') return '/cart'
  return '/profile'
}

/** Match a contribution by its pathname while preserving the full hash for
 * the mounted module to read its own query parameters. */
export function contributionPath(hash: string): string {
  const value = hash.startsWith('#') ? hash.slice(1) : hash
  return (value.split('?', 1)[0] || '').trim()
}

function renderStandardShell(root: HTMLElement, config: HostConfig): HostShell {
  root.innerHTML = `<div class="ls-host"><header class="ls-host__header"><div class="ls-host__brand">${config.title}</div><div class="ls-host__meta">${config.surface} Host · registry driven</div></header><div class="ls-host__body"><nav class="ls-host__nav"><div class="ls-host__nav-title">Registered modules</div><div data-nav></div></nav><main class="ls-host__content"><section class="ls-host__page-summary ls-card" data-page-summary><h1 data-page-summary-title></h1><p data-page-summary-description></p></section><section data-page></section><section data-outlets></section></main></div></div>`
  return {
    nav: root.querySelector<HTMLElement>('[data-nav]')!,
    summary: root.querySelector<HTMLElement>('[data-page-summary]')!,
    summaryTitle: root.querySelector<HTMLElement>('[data-page-summary-title]')!,
    summaryDescription: root.querySelector<HTMLElement>('[data-page-summary-description]')!,
    page: root.querySelector<HTMLElement>('[data-page]')!,
    outletRoot: root.querySelector<HTMLElement>('[data-outlets]')!,
  }
}

function renderStorefrontShell(root: HTMLElement, config: HostConfig): HostShell {
  const shell = document.createElement('div')
  shell.className = 'ls-storefront'
  const initialPath = contributionPath(location.hash) || '/'
  shell.dataset.routeKind = storefrontNavigation.some(item => item.route === initialPath) ? 'primary' : 'secondary'

  const header = document.createElement('header')
  header.className = 'ls-storefront__header'
  const headerInner = document.createElement('div')
  headerInner.className = 'ls-storefront__header-inner'

  const brand = document.createElement('a')
  brand.className = 'ls-storefront__brand'
  brand.href = '#/'
  const mark = document.createElement('span')
  mark.className = 'ls-storefront__brand-mark'
  mark.textContent = 'W'
  const brandCopy = document.createElement('span')
  brandCopy.className = 'ls-storefront__brand-copy'
  const brandName = document.createElement('strong')
  brandName.textContent = 'WOKFOY SHOP'
  const brandCaption = document.createElement('small')
  brandCaption.textContent = '轻松发现每一份心动'
  brandCopy.append(brandName, brandCaption)
  brand.append(mark, brandCopy)

  const desktopNav = document.createElement('nav')
  desktopNav.className = 'ls-storefront__desktop-nav'
  desktopNav.setAttribute('aria-label', '商城主导航')

  const search = document.createElement('button')
  search.type = 'button'
  search.className = 'ls-storefront__search'
  search.setAttribute('aria-label', '搜索商品')
  search.append(storefrontIcon('search'), document.createTextNode('搜索商品'))
  search.addEventListener('click', () => { location.hash = '/search' })

  const language = document.createElement('label')
  language.className = 'ls-storefront__language'
  language.append(storefrontIcon('globe'))
  const languageSelect = document.createElement('select')
  languageSelect.setAttribute('aria-label', '语言')
  const currentLocale = resolveHostLocale({ surface: config.surface, ...shopLocaleMeta() })
  const published = shopLocaleMeta().publishedLocales || []
  const languageOptions = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en-US', label: 'English' },
  ].filter(item => published.length === 0 || published.includes(item.value))
  for (const item of languageOptions.length ? languageOptions : [{ value: 'zh-CN', label: '简体中文' }]) {
    const option = document.createElement('option')
    option.value = item.value
    option.textContent = item.label
    option.selected = item.value === currentLocale
    languageSelect.append(option)
  }
  languageSelect.addEventListener('change', () => {
    persistLocale(languageSelect.value)
    location.reload()
  })
  language.append(languageSelect)

  const actions = document.createElement('div')
  actions.className = 'ls-storefront__actions'
  for (const item of [{ route: '/profile', label: '我的账户', icon: 'user' }, { route: '/cart', label: '购物车', icon: 'cart' }] as const) {
    const link = document.createElement('a')
    link.href = `#${item.route}`
    link.setAttribute('aria-label', item.label)
    link.append(storefrontIcon(item.icon))
    if (item.route === '/cart') link.classList.add('ls-storefront__cart-action')
    actions.append(link)
  }

  headerInner.append(brand, desktopNav, search, language, actions)
  header.append(headerInner)

  const content = document.createElement('main')
  content.className = 'ls-storefront__content'
  const summary = document.createElement('section')
  summary.className = 'ls-storefront__page-summary'
  summary.setAttribute('data-page-summary', '')
  const summaryBack = document.createElement('button')
  summaryBack.type = 'button'
  summaryBack.className = 'ls-storefront__page-back'
  summaryBack.setAttribute('aria-label', '返回')
  summaryBack.append(storefrontIcon('back'))
  summaryBack.addEventListener('click', () => history.back())
  const summaryTitle = document.createElement('h1')
  summaryTitle.setAttribute('data-page-summary-title', '')
  const summaryDescription = document.createElement('p')
  summaryDescription.setAttribute('data-page-summary-description', '')
  summary.append(summaryBack, summaryTitle, summaryDescription)
  const page = document.createElement('section')
  page.className = 'ls-storefront__page'
  page.setAttribute('data-page', '')
  page.innerHTML = '<div class="ls-storefront__route-skeleton" aria-label="页面加载中"><i></i><i></i><i></i><i></i></div>'
  const outletRoot = document.createElement('section')
  outletRoot.className = 'ls-storefront__outlets'
  outletRoot.setAttribute('data-outlets', '')
  content.append(summary, page, outletRoot)

  const mobileNav = document.createElement('nav')
  mobileNav.className = 'ls-storefront__mobile-nav'
  mobileNav.setAttribute('aria-label', '商城主导航')

  for (const item of storefrontNavigation) {
    for (const nav of [desktopNav, mobileNav]) {
      const link = document.createElement('a')
      link.href = `#${item.route}`
      link.dataset.storefrontRoute = item.route
      if ('featured' in item && item.featured) link.dataset.featured = 'true'
      const icon = document.createElement('span')
      icon.append(storefrontIcon(item.icon))
      const label = document.createElement('span')
      label.textContent = item.label
      link.append(icon, label)
      nav.append(link)
    }
  }

  shell.append(header, content, mobileNav)
  root.replaceChildren(shell)
  return { nav: shell, summary, summaryTitle, summaryDescription, page, outletRoot }
}

async function mountStorefrontShell(root: HTMLElement, config: HostConfig): Promise<void> {
  const { nav, summary, summaryTitle, summaryDescription, page, outletRoot } = renderStorefrontShell(root, config)
  const { pages, byOutlet } = await loadRegistry(config)
  let pageDisposer: ContributionDisposer | undefined
  let renderRevision = 0
  const renderPage = async () => {
    const revision = ++renderRevision
    const previous = pageDisposer
    pageDisposer = undefined
    await previous?.()
    if (revision !== renderRevision) return
    const path = contributionPath(location.hash) || '/'
    const selected = pages.find((item) => item.route === path)
    const section = storefrontSection(path)
    nav.querySelectorAll<HTMLElement>('[data-storefront-route]').forEach((link) => {
      const active = link.dataset.storefrontRoute === section
      link.dataset.active = String(active)
      if (active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
    if (!selected) {
      summary.hidden = false
      summaryTitle.textContent = '页面建设中'
      summaryDescription.textContent = '该商城页面尚未发布到当前 Registry。'
      page.replaceChildren()
      return
    }
    const routeKind = storefrontNavigation.some(item => item.route === selected.route) ? 'primary' : 'secondary'
    nav.dataset.routeKind = routeKind
    summary.hidden = routeKind === 'primary'
    summary.dataset.routeKind = routeKind
    summaryTitle.textContent = selected.title
    summaryDescription.textContent = selected.description
    if (selected.contribution) {
      const mounted = await mountContribution(page, config, selected.contribution)
      if (revision === renderRevision) pageDisposer = mounted
      else await mounted()
    } else if (selected.native) {
      await selected.native.render(page, { gatewayBaseUrl: config.gatewayBaseUrl, accessToken: config.accessToken })
    }
  }
  for (const outlet of config.outlets) {
    const items = byOutlet.get(outlet) || []
    if (!items.length) continue
    const section = document.createElement('section')
    section.className = 'ls-storefront__outlet'
    section.dataset.outlet = outlet
    outletRoot.append(section)
    for (const item of items) {
      const target = document.createElement('div')
      section.append(target)
      await mountContribution(target, config, item)
    }
  }
  window.addEventListener('hashchange', () => { void renderPage() })
  await renderPage()
}

export async function mountHost(root: HTMLElement, config: HostConfig): Promise<void> {
  const { nav, summary, summaryTitle, summaryDescription, page, outletRoot } = renderStandardShell(root, config)
  const { pages, byOutlet } = await loadRegistry(config)
  let pageDisposer: ContributionDisposer | undefined
  let renderRevision = 0
  const renderPage = async () => {
    const revision = ++renderRevision
    const previous = pageDisposer
    pageDisposer = undefined
    await previous?.()
    if (revision !== renderRevision) return
    const path = contributionPath(location.hash) || pages[0]?.route || ''
    const selected = pages.find((item) => item.route === path)
    nav.querySelectorAll('a').forEach((link) => link.setAttribute('data-active', String(link.getAttribute('href') === `#${path}`)))
    if (!selected) {
      summary.hidden = true
      page.replaceChildren()
      return
    }
    summary.hidden = false
    summaryTitle.textContent = selected.title
    summaryDescription.textContent = selected.description
    if (selected.contribution) {
      const mounted = await mountContribution(page, config, selected.contribution)
      if (revision === renderRevision) pageDisposer = mounted
      else await mounted()
    }
    else if (selected.native) await selected.native.render(page, { gatewayBaseUrl: config.gatewayBaseUrl, accessToken: config.accessToken })
  }
  for (const item of pages) {
    const link = document.createElement('a')
    link.href = `#${item.route}`
    link.textContent = item.title
    nav.append(link)
  }
  for (const outlet of config.outlets) {
    const section = document.createElement('section')
    section.className = 'ls-host__outlet'
    section.innerHTML = `<div class="ls-host__outlet-label">Outlet: ${outlet}</div>`
    outletRoot.append(section)
    for (const item of byOutlet.get(outlet) || []) {
      const target = document.createElement('div')
      target.className = 'ls-card'
      section.append(target)
      await mountContribution(target, config, item)
    }
  }
  window.addEventListener('hashchange', () => { void renderPage() })
  await renderPage()
}

function renderStorefrontStatus(root: HTMLElement, title: string, description: string): void {
  root.innerHTML = `<main class="ls-shop-auth"><section class="ls-shop-auth__card"><div class="ls-shop-auth__mark">LS</div><h1>${title}</h1><p>${description}</p></section></main>`
}

function storefrontLoginPage(
  config: AuthenticatedStorefrontHostConfig,
  authenticate: (token: string) => Promise<void>,
): NativeConsolePage {
  return {
    id: 'host.storefront.login',
    route: config.surface === 'shop' ? '/profile' : '/login',
    title: '买家登录',
    description: '登录后可使用个人资料、订单等账户专属能力。',
    sort: 10_000,
    render(container) {
      container.innerHTML = '<section class="ls-shop-auth__card"><h2>买家登录</h2><p>商品、直播和游客购物车无需登录。</p><form data-shop-login><label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="ls-shop-auth__error" data-login-error role="alert"></p><button class="ls-shop-cta ls-shop-cta--block" type="submit">登录</button></form><small data-shop-code></small></section>'
      container.querySelector<HTMLElement>('[data-shop-code]')!.textContent = `当前店铺：${config.shopCode}`
      const form = container.querySelector<HTMLFormElement>('[data-shop-login]')!
      const error = container.querySelector<HTMLElement>('[data-login-error]')!
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
        const values = new FormData(form)
        error.textContent = ''
        submit.disabled = true
        submit.textContent = '登录中…'
        void login(config, {
          username: String(values.get('username') || ''),
          password: String(values.get('password') || ''),
        }).then((session) => authenticate(session.accessToken)).catch((failure) => {
          error.textContent = failure instanceof Error ? failure.message : String(failure)
          submit.disabled = false
          submit.textContent = '登录'
        })
      })
    },
  }
}

/**
 * Shop and Live always establish a Customer-realm identity. Existing customer
 * or guest sessions are restored first; a missing session becomes a durable,
 * shop-bound guest without interrupting public browsing with a login wall.
 */
export async function mountStorefrontHost(root: HTMLElement, config: AuthenticatedStorefrontHostConfig): Promise<void> {
  let mount: (token: string) => Promise<void>
  const loginPage = storefrontLoginPage(config, async (token) => mount(token))
  mount = async (token: string) => {
    let currentToken = token
    let renewal: Promise<string> | undefined
    const renewAccessToken = () => {
      if (!renewal) {
        renewal = refreshAccessToken(config)
          .catch(() => guestAccessToken(config))
          .then((session) => {
            currentToken = session.accessToken
            return currentToken
          })
          .finally(() => { renewal = undefined })
      }
      return renewal
    }
    const authenticated = {
      ...config,
      nativePages: [...(config.nativePages || []), loginPage],
      accessToken: async () => currentToken,
      renewAccessToken,
    }
    if (config.surface === 'shop') return mountStorefrontShell(root, authenticated)
    return mountHost(root, authenticated)
  }
  renderStorefrontStatus(root, '正在进入店铺…', '正在恢复买家身份或建立游客会话。')
  const stored = storedAccessToken(config.realm)
  if (stored) {
    try {
      await mount(stored)
      return
    } catch {
      clearAccessToken(config.realm)
    }
  }
  try {
    const session = await refreshAccessToken(config)
    await mount(session.accessToken)
  } catch {
    const session = await guestAccessToken(config)
    await mount(session.accessToken)
  }
}

export async function browserAccessToken(storageKey = 'liveshop.access_token'): Promise<string> {
  const token = sessionStorage.getItem(storageKey)
  if (!token) throw new Error(`authenticated access token is missing from sessionStorage key ${storageKey}`)
  return token
}

export type {
  AuthenticatedConsoleHostConfig,
  AuthenticatedStorefrontHostConfig,
  ConsoleHostConfig,
  ConsoleSurface,
  HostConfig,
  HostPage,
  NativeConsolePage,
  NativePageContext,
  Principal,
  Session,
} from './runtime'
