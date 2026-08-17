// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConsoleLayout, type ConsoleLayoutProps } from './ConsoleLayout'

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

describe('ConsoleLayout page scrolling', () => {
  const render = async (activeRoute: string) => {
    const props: ConsoleLayoutProps = {
      surface: 'admin', title: 'LiveShop', subtitle: '管理后台', pages: [], openTabs: [], activeRoute,
      onNavigate() {}, onCloseTab() {}, onLogout() {}, children: <div>页面内容</div>,
    }
    await act(async () => { root.render(<ConsoleLayout {...props} />) })
  }

  it('returns to the page summary whenever the active menu changes', async () => {
    await render('/first')
    expect(container.firstElementChild?.classList.contains('h-full')).toBe(true)
    expect(container.firstElementChild?.classList.contains('h-screen')).toBe(false)
    const scroller = container.querySelector<HTMLElement>('[data-page-scroll-container]')!
    expect(scroller.style.overflowAnchor).toBe('none')
    scroller.scrollTop = 128
    scroller.scrollLeft = 24

    await render('/second')

    expect(scroller.scrollTop).toBe(0)
    expect(scroller.scrollLeft).toBe(0)
  })

  it('keeps the summary visible when a directly opened route finishes loading', async () => {
    await render('/orders')
    const scroller = container.querySelector<HTMLElement>('[data-page-scroll-container]')!
    scroller.scrollTop = 107

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    })

    expect(scroller.scrollTop).toBe(0)
  })
})
