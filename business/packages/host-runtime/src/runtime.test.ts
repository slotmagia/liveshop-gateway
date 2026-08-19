// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOST_PROTOCOL, type HostContext } from '@liveshop/host-sdk'
import { closeIframeHostOverlay, guestAccessToken, handleHostNotifyMessage, loadRegistry, login, mountContribution, normalizeIframeContentHeight, openIframeHostOverlay, reconcileRegistryRefresh, subscribeModuleCapabilityRefresh, subscribeRegistryRefresh, updateIframeContentHeight, type HostRegistry } from './runtime'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  document.getElementById('ls-ui-toast-host')?.remove()
})

describe('host notify', () => {
  it('renders module toasts onto the Host document', () => {
    expect(handleHostNotifyMessage({
      type: 'LIVESHOP_HOST_NOTIFY', protocol: HOST_PROTOCOL, text: '没有可分配的活动角色，请先在角色管理中创建。', tone: 'warning',
    })).toBe(true)
    const toast = document.getElementById('ls-ui-toast-host')
    expect(toast?.textContent).toContain('没有可分配的活动角色')
    expect(toast?.querySelector('.ls-ui-toast--warning')).toBeTruthy()
  })

  it('rejects empty or oversized notify payloads', () => {
    expect(handleHostNotifyMessage({ type: 'LIVESHOP_HOST_NOTIFY', protocol: HOST_PROTOCOL, text: '   ', tone: 'info' })).toBe(false)
    expect(handleHostNotifyMessage({ type: 'LIVESHOP_HOST_NOTIFY', protocol: HOST_PROTOCOL, text: 'x'.repeat(501), tone: 'info' })).toBe(false)
  })
})

describe('customer authentication', () => {
  it('binds a Customer login to the configured shop namespace', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0,
      data: { accessToken: 'customer-token', expiresIn: 900, principal: { realm: 'CUSTOMER', principalType: 'CUSTOMER', subject: 'customer-local', username: 'customer' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const session = await login({ surface: 'shop', realm: 'CUSTOMER', shopCode: 'local-shop', gatewayBaseUrl: 'http://gateway.test' }, { username: 'customer', password: '123456' })

    expect(session.accessToken).toBe('customer-token')
    expect(sessionStorage.getItem('liveshop.access_token.customer')).toBe('customer-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ realm: 'CUSTOMER', username: 'customer', password: '123456', shopCode: 'local-shop' })
  })

    it('sends a verified challenge without a password', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0,
      data: { accessToken: 'otp-token', expiresIn: 900, principal: { realm: 'CUSTOMER', principalType: 'CUSTOMER', subject: 'customer-otp', username: '' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const session = await login({ surface: 'shop', realm: 'CUSTOMER', shopCode: 'local-shop', gatewayBaseUrl: 'http://gateway.test' }, { challengeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })

    expect(session.accessToken).toBe('otp-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      realm: 'CUSTOMER', shopCode: 'local-shop', challengeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  it('creates and stores a shop-bound guest identity', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { accessToken: 'guest-token', expiresIn: 900, principal: { realm: 'CUSTOMER', principalType: 'GUEST', subject: 'guest-1', username: '' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const session = await guestAccessToken({ surface: 'live', title: 'Live', outlets: [], realm: 'CUSTOMER', shopCode: 'local-shop', gatewayBaseUrl: 'http://gateway.test' })

    expect(session.principal.principalType).toBe('GUEST')
    expect(sessionStorage.getItem('liveshop.access_token.customer')).toBe('guest-token')
    expect(fetchMock).toHaveBeenCalledWith('http://gateway.test/auth/guest', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ shopCode: 'local-shop' }),
    }))
  })
})

describe('iframe contribution permissions', () => {
  it('delegates clipboard-write so module copy buttons work in the Host iframe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { token: 'module-token', expiresIn: 900, permissions: [], tenant: { merchantId: 2001, shopId: 3001 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const container = document.createElement('div')
    document.body.append(container)
    const dispose = await mountContribution(container, {
      surface: 'merch', title: 'Merch', gatewayBaseUrl: 'http://gateway.test', outlets: [],
      accessToken: async () => 'access',
    }, {
      moduleId: 'identity',
      moduleVersion: '2.0.8',
      contribution: {
        id: 'identity.merch.shops',
        surface: 'merch',
        kind: 'page',
        title: '店铺管理',
        description: 'shops',
        requiredPermissions: [],
        allowedRoutes: [],
        artifact: {
          type: 'iframe',
          name: '@liveshop/identity-merch',
          version: '2.0.8',
          entry: 'http://artifact.test/',
          integrity: 'sha256:deadbeef',
        },
      },
    })

    const iframe = container.querySelector('iframe')
    expect(container.querySelector('.ls-host__error')?.textContent).toBeUndefined()
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('allow')).toBe('clipboard-write')
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts')
    await dispose()
    container.remove()
  })
})

describe('iframe contribution sizing', () => {
  it('rounds valid document heights and rejects untrusted values', () => {
    expect(normalizeIframeContentHeight(1200.2)).toBe(1201)
    expect(normalizeIframeContentHeight(0)).toBeUndefined()
    expect(normalizeIframeContentHeight(Number.NaN)).toBeUndefined()
    expect(normalizeIframeContentHeight(100_001)).toBeUndefined()
    expect(normalizeIframeContentHeight('1200')).toBeUndefined()
  })

  it('clamps a long contribution to the Host viewport and restores its latest reported height', () => {
    const iframe = document.createElement('iframe')
    iframe.style.height = '6200px'
    document.body.append(iframe)

    const overlay = openIframeHostOverlay(iframe, 'overlay-request-1')
    expect(iframe.style.height).toBe('100dvh')
    expect(iframe.classList.contains('ls-host__frame--overlay')).toBe(true)
    expect(document.documentElement.classList.contains('ls-host--overlay-open')).toBe(true)

    updateIframeContentHeight(iframe, overlay, '6800px')
    expect(iframe.style.height).toBe('100dvh')
    expect(closeIframeHostOverlay(iframe, overlay, 'different-request')).toBe(overlay)

    const closed = closeIframeHostOverlay(iframe, overlay, 'overlay-request-1')
    expect(closed).toBeUndefined()
    expect(iframe.style.height).toBe('6800px')
    expect(iframe.classList.contains('ls-host__frame--overlay')).toBe(false)
    expect(document.documentElement.classList.contains('ls-host--overlay-open')).toBe(false)
    iframe.remove()
  })
})

describe('registry refresh subscription', () => {
  it('renews an expired access identity once and retries the registry request', async () => {
    const accessToken = vi.fn(async () => 'expired-token')
    const renewAccessToken = vi.fn(async () => 'renewed-token')
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('Authorization')
      if (authorization === 'Bearer expired-token') {
        return new Response(JSON.stringify({ code: 40100, message: 'valid access identity is required' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ code: 0, data: { revision: 7, items: [] } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const registry = await loadRegistry({
      surface: 'admin', title: 'Admin', gatewayBaseUrl: 'http://gateway.test', outlets: [], accessToken, renewAccessToken,
    })

    expect(registry.revision).toBe(7)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(renewAccessToken).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer renewed-token')
  })

  it('surfaces the identity error when contributions cannot be read', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 50300, message: 'identity: registry projection is unavailable or stale' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadRegistry({
      surface: 'admin', title: 'Admin', gatewayBaseUrl: 'http://gateway.test', outlets: [],
      accessToken: async () => 'token',
    })).rejects.toThrow('identity: registry projection is unavailable or stale')
  })

  it('retains the mounted snapshot for equal or stale poll revisions', () => {
    const current: HostRegistry = { revision: 7, pages: [], byOutlet: new Map() }
    const equal: HostRegistry = { revision: 7, pages: [], byOutlet: new Map() }
    const stale: HostRegistry = { revision: 6, pages: [], byOutlet: new Map() }
    const newer: HostRegistry = { revision: 8, pages: [], byOutlet: new Map() }

    expect(reconcileRegistryRefresh(current, equal)).toBe(current)
    expect(reconcileRegistryRefresh(current, stale)).toBe(current)
    expect(reconcileRegistryRefresh(current, newer)).toBe(newer)
  })

  it('refreshes periodically and when the Host regains focus', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    const onError = vi.fn()
    const dispose = subscribeRegistryRefresh(refresh, onError, 1_000)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('focus'))
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()

    dispose()
    await vi.advanceTimersByTimeAsync(2_000)
    window.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('coalesces overlapping refresh signals and reports failures', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const refresh = vi.fn()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error('registry unavailable'))
    const onError = vi.fn()
    const dispose = subscribeRegistryRefresh(refresh, onError, 1_000)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(refresh).toHaveBeenCalledTimes(1)

    release()
    await first
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)

    dispose()
  })
})

function capabilityGrant(expiresIn: number, moduleToken: string) {
  const context: HostContext = {
    protocol: 2,
    surface: 'admin',
    moduleId: 'trade',
    moduleVersion: '0.3.0',
    contributionId: 'trade.admin.orders',
    moduleToken,
    gatewayBaseUrl: 'http://gateway.test',
    locale: 'zh-CN',
    permissions: ['trade.order.read'],
    tenant: { merchantId: 0, shopId: 0 },
    theme: { mode: 'light' },
  }
  return { context, expiresIn }
}

describe('module capability refresh subscription', () => {
  it('renews before expiry and schedules from the new grant lifetime', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => capabilityGrant(10, 'renewed'))
    const onGrant = vi.fn()
    const onError = vi.fn()
    const dispose = subscribeModuleCapabilityRefresh(refresh, onGrant, onError, 5, 1_000, 500)

    await vi.advanceTimersByTimeAsync(3_999)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onGrant).toHaveBeenCalledWith(capabilityGrant(10, 'renewed'))
    expect(onError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(8_999)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('retries a failed renewal and stops after disposal', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(capabilityGrant(5, 'renewed'))
    const onGrant = vi.fn()
    const onError = vi.fn()
    const dispose = subscribeModuleCapabilityRefresh(refresh, onGrant, onError, 2, 1_000, 500)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(onError).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(onGrant).toHaveBeenCalledTimes(1)

    dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
