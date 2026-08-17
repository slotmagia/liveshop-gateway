// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HostConfig, HostPage } from '../runtime'
import { PageOutlet } from './PageOutlet'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

describe('PageOutlet menu summary', () => {
  it('renders the Registry title and description before native page content', async () => {
    const page: HostPage = {
      id: 'native.test',
      route: '/test',
      title: '店铺品类',
      description: '平台维护的售卖品类目录，商户建店时从中自选一个。',
      sort: 0,
      native: {
        id: 'native.test', route: '/test', title: '店铺品类',
        description: '平台维护的售卖品类目录，商户建店时从中自选一个。', sort: 0,
        render(target) { target.textContent = '业务内容' },
      },
    }
    const config: HostConfig = { surface: 'admin', title: 'Host', gatewayBaseUrl: '', outlets: [], accessToken: async () => '' }

    await act(async () => { root.render(<PageOutlet page={page} config={config} />) })

    const summary = container.querySelector<HTMLElement>('[data-page-summary]')
    expect(summary?.querySelector('h1')?.textContent).toBe('店铺品类')
    expect(summary?.querySelector('p')?.textContent).toBe(page.description)
    expect(summary?.nextElementSibling?.textContent).toContain('业务内容')
  })

  it('restores the summary after a contribution finishes mounting', async () => {
    const first: HostPage = {
      id: 'native.first', route: '/first', title: '第一页', description: '第一页说明', sort: 0,
      native: { id: 'native.first', route: '/first', title: '第一页', description: '第一页说明', sort: 0, render(target) { target.textContent = '一' } },
    }
    const second: HostPage = {
      id: 'native.second', route: '/second', title: '第二页', description: '第二页说明', sort: 1,
      native: { id: 'native.second', route: '/second', title: '第二页', description: '第二页说明', sort: 1, render(target) { target.textContent = '二' } },
    }
    const config: HostConfig = { surface: 'admin', title: 'Host', gatewayBaseUrl: '', outlets: [], accessToken: async () => '' }
    const render = async (page: HostPage) => act(async () => {
      root.render(<main data-page-scroll-container><PageOutlet page={page} config={config} /></main>)
    })

    await render(first)
    const scroller = container.querySelector<HTMLElement>('[data-page-scroll-container]')!
    scroller.scrollTop = 96
    await render(second)

    expect(scroller.scrollTop).toBe(0)
    expect(container.querySelector('[data-page-summary] h1')?.textContent).toBe('第二页')
  })
})
