// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loadRegistry, refreshAccessToken, storedAccessToken, subscribeRegistryRefresh } = vi.hoisted(() => ({
  loadRegistry: vi.fn(),
  refreshAccessToken: vi.fn(),
  storedAccessToken: vi.fn(),
  subscribeRegistryRefresh: vi.fn(() => () => {}),
}))

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>()
  return {
    ...actual,
    loadRegistry,
    refreshAccessToken,
    storedAccessToken,
    subscribeRegistryRefresh,
    clearAccessToken: vi.fn(),
    logout: vi.fn(async () => {}),
  }
})

import { ConsoleApp } from './ConsoleApp'

let container: HTMLDivElement
let root: Root

const config = {
  surface: 'admin' as const,
  realm: 'PLATFORM' as const,
  gatewayBaseUrl: 'http://gateway.test',
}

const principal = {
  realm: 'PLATFORM',
  principalType: 'PLATFORM_OPERATOR',
  subject: 'platform-admin',
  username: 'admin',
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  loadRegistry.mockReset()
  refreshAccessToken.mockReset()
  storedAccessToken.mockReset()
  subscribeRegistryRefresh.mockReset()
  subscribeRegistryRefresh.mockReturnValue(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ConsoleApp registry recovery', () => {
  it('does not refresh in a loop when contributions keep failing', async () => {
    storedAccessToken.mockReturnValue('stored-token')
    loadRegistry.mockRejectedValue(new Error('cannot load module contributions'))
    refreshAccessToken.mockResolvedValue({ accessToken: 'renewed-token', principal })

    await act(async () => {
      root.render(<ConsoleApp config={config} />)
    })
    await flush()
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flush()

    expect(refreshAccessToken.mock.calls.length).toBeLessThanOrEqual(2)
    expect(loadRegistry.mock.calls.length).toBeLessThanOrEqual(4)
    expect(container.textContent).toContain('无法加载已注册模块')
    expect(container.textContent).not.toContain('正在加载已注册模块')
  })

  it('loads the registry after a single session recovery', async () => {
    storedAccessToken.mockReturnValue('stored-token')
    loadRegistry
      .mockRejectedValueOnce(new Error('cannot load module contributions'))
      .mockResolvedValue({ revision: 1, pages: [], byOutlet: new Map() })
    refreshAccessToken.mockResolvedValue({ accessToken: 'renewed-token', principal })

    await act(async () => {
      root.render(<ConsoleApp config={config} />)
    })
    await flush()
    await flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flush()

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('正在加载已注册模块')
    expect(container.textContent).not.toContain('无法加载已注册模块')
  })
})
