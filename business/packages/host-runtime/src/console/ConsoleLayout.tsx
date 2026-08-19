import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LogOut, PanelLeftClose, PanelLeftOpen, Search, ShieldCheck, Store, X } from 'lucide-react'
import { groupNavIcon, pageNavIcon } from './icons'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../lib/cn'
import type { ConsoleSurface, HostPage, Principal } from '../runtime'
import { persistLocale, resolveHostLocale } from '../locale'
import { groupNavigationPages } from './navigation'

const SIDEBAR_STORAGE_KEY = 'liveshop.console.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // The layout still works when storage is unavailable.
  }
}

export interface ConsoleLayoutProps {
  surface: ConsoleSurface
  title: string
  subtitle: string
  principal?: Principal
  pages: HostPage[]
  openTabs: HostPage[]
  activeRoute: string
  onNavigate(route: string): void
  onCloseTab(page: HostPage): void
  onLogout(): void
  children: ReactNode
}

/**
 * The back-office chrome. One implementation renders both the platform and the
 * merchant console; only the registry scope and the surface badge differ.
 */
export function ConsoleLayout(props: ConsoleLayoutProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [query, setQuery] = useState('')
  const pageScroller = useRef<HTMLElement>(null)

  useEffect(() => {
    const resetPageScroll = () => {
      if (!pageScroller.current) return
      pageScroller.current.scrollTop = 0
      pageScroller.current.scrollLeft = 0
    }
    resetPageScroll()
    // A directly opened hash route is restored while iframe subresources are
    // still loading. Chromium may restore the nested scroller after React's
    // route effect, so the document load boundary must enforce the same page
    // invariant once more. SPA menu changes still reset synchronously above.
    if (document.readyState === 'complete') {
      const frame = window.requestAnimationFrame(resetPageScroll)
      return () => window.cancelAnimationFrame(frame)
    }
    window.addEventListener('load', resetPageScroll)
    return () => window.removeEventListener('load', resetPageScroll)
  }, [props.activeRoute])

  const visiblePages = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return props.pages
    return props.pages.filter((page) => page.title.toLowerCase().includes(keyword) || page.id.toLowerCase().includes(keyword))
  }, [props.pages, query])
  const navigationGroups = useMemo(() => groupNavigationPages(visiblePages), [visiblePages])

  const toggleSidebar = () => {
    setCollapsed((previous) => {
      writeCollapsed(!previous)
      return !previous
    })
  }

  const BrandIcon = props.surface === 'admin' ? ShieldCheck : Store

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
          <BrandIcon className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-none">{props.title}</p>
          <p className="mt-0.5 truncate text-xs2 text-muted-foreground">{props.subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开导航' : '收起导航'}
          title={collapsed ? '展开导航' : '收起导航'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <label className="hidden items-center gap-1 text-xs text-muted-foreground md:inline-flex">
            <span className="sr-only">语言</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
              aria-label="语言"
              defaultValue={resolveHostLocale({ surface: props.surface })}
              onChange={(event) => {
                persistLocale(event.currentTarget.value)
                location.reload()
              }}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <span className="hidden items-center gap-2 text-xs font-semibold text-ink-soft md:inline-flex">
            <i className="h-[7px] w-[7px] rounded-full bg-success shadow-[0_0_0_3px_var(--ls-success-bg)]" />
            {props.surface === 'admin' ? '平台端' : '商家端'}
          </span>
          {props.principal && (
            <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground md:inline">{props.principal.username}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={props.onLogout}
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'flex shrink-0 flex-col overflow-hidden border-r bg-card transition-[width] duration-200 ease-in-out',
            collapsed ? 'w-0 border-r-0' : 'w-60',
          )}
          inert={collapsed}
          aria-hidden={collapsed}
        >
          <div className="relative shrink-0 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 rounded-lg bg-muted/60 pl-8 pr-8 shadow-none"
              placeholder="搜索菜单"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索菜单"
            />
            {query && (
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-thin p-2" aria-label="功能导航">
            {navigationGroups.map((group) => {
              const GroupIcon = groupNavIcon(group.id, group.icon)
              return (
              <section key={group.id} aria-label={group.title} className="pb-1">
                <div className="flex items-center gap-2 px-2 py-2 text-xs2 font-bold tracking-[0.06em] text-ink-subtle">
                  <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>{group.title}</span>
                </div>
                {group.pages.map((page) => {
                  const PageIcon = pageNavIcon(page)
                  return (
                  <a
                    key={page.id}
                    href={`#${page.route}`}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      group.id !== 'host-workbench' && 'ml-2 border-l border-border pl-3',
                      page.route === props.activeRoute
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                    onClick={(event) => {
                      event.preventDefault()
                      props.onNavigate(page.route)
                    }}
                  >
                    <PageIcon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{page.title}</span>
                  </a>
                  )
                })}
              </section>
              )
            })}
            {visiblePages.length === 0 && (
              <div className="px-3 py-4 text-xs text-ink-subtle">{props.pages.length ? '没有匹配的菜单' : '暂无已注册页面'}</div>
            )}
          </nav>
          <div className="flex shrink-0 items-center gap-2 border-t px-4 py-3 text-xs2 text-muted-foreground">
            <i className="h-[7px] w-[7px] rounded-full bg-success shadow-[0_0_0_3px_var(--ls-success-bg)]" />
            动态模块已启用
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b bg-card px-2 scrollbar-thin" aria-label="工作区标签">
            {props.openTabs.length === 0 && <span className="self-center px-3 text-xs text-ink-subtle">工作区</span>}
            {props.openTabs.map((page, index) => (
              <div
                key={page.id}
                className={cn(
                  'relative flex shrink-0 items-center text-sm transition-colors',
                  page.route === props.activeRoute
                    ? 'font-medium text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t after:bg-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <a
                  href={`#${page.route}`}
                  className="flex h-full max-w-[180px] items-center truncate px-3"
                  title={page.title}
                  onClick={(event) => {
                    event.preventDefault()
                    props.onNavigate(page.route)
                  }}
                >
                  {page.title}
                </a>
                {index > 0 && (
                  <button
                    type="button"
                    className="mr-2 flex h-[18px] w-[18px] items-center justify-center rounded-sm text-ink-subtle hover:bg-surface-3 hover:text-foreground"
                    aria-label={`关闭 ${page.title}`}
                    onClick={() => props.onCloseTab(page)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <main
            ref={pageScroller}
            data-page-scroll-container
            className="min-h-0 flex-1 overflow-auto bg-background scrollbar-thin"
            // The Registry summary is inserted before an iframe. Chromium can
            // otherwise keep the iframe as its scroll anchor and move the
            // summary above the viewport when the module document finishes
            // loading, even after the route effect reset scrollTop to zero.
            style={{ overflowAnchor: 'none' }}
          >
            <div className="min-h-full w-full px-2 pb-3 pt-2">{props.children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
