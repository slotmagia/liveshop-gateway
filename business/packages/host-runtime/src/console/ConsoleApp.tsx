import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { ConsoleLayout } from './ConsoleLayout'
import { LoginPage } from './LoginPage'
import { OutletStrip, PageOutlet } from './PageOutlet'
import { Button } from '../ui/button'
import {
  clearAccessToken,
  consoleSurfaces,
  loadRegistry,
  logout,
  reconcileRegistryRefresh,
  refreshAccessToken,
  storedAccessToken,
  subscribeRegistryRefresh,
  type AuthenticatedConsoleHostConfig,
  type HostConfig,
  type HostPage,
  type HostRegistry,
  type Principal,
} from '../runtime'

function currentRoute(): string {
  return location.hash.slice(1)
}

function useHashRoute(): string {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const sync = () => setRoute(currentRoute())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return route
}

function CenteredNotice({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background p-6">{children}</div>
}

/**
 * The authenticated console: registry-driven navigation, workspace tabs and the
 * dashboard outlets. Session recovery matches the pre-React behaviour — a
 * rejected token is dropped, a refresh is attempted, and only then does the
 * login screen come back.
 */
export function ConsoleApp({ config }: { config: AuthenticatedConsoleHostConfig }) {
  const presentation = consoleSurfaces[config.surface]
  const [token, setToken] = useState('')
  const [principal, setPrincipal] = useState<Principal>()
  const [booting, setBooting] = useState(true)
  const [registry, setRegistry] = useState<HostRegistry>()
  const [failure, setFailure] = useState('')
  const [openTabs, setOpenTabs] = useState<HostPage[]>([])
  const route = useHashRoute()
  const tokenRef = useRef('')
  const refreshRef = useRef<Promise<string> | null>(null)
  tokenRef.current = token

  const renewToken = useCallback((): Promise<string> => {
    if (!refreshRef.current) {
      refreshRef.current = refreshAccessToken(config)
        .then((session) => {
          tokenRef.current = session.accessToken
          setPrincipal(session.principal)
          setToken(session.accessToken)
          return session.accessToken
        })
        .catch((error) => {
          clearAccessToken(config.realm)
          tokenRef.current = ''
          setToken('')
          setRegistry(undefined)
          setFailure('会话已失效，请重新登录')
          throw error
        })
        .finally(() => { refreshRef.current = null })
    }
    return refreshRef.current
  }, [config])

  const hostConfig = useMemo<HostConfig>(() => ({
    surface: config.surface,
    title: presentation.title,
    gatewayBaseUrl: config.gatewayBaseUrl,
    outlets: presentation.outlets,
    nativePages: config.nativePages,
    accessToken: async () => tokenRef.current,
    renewAccessToken: renewToken,
  }), [config.surface, config.gatewayBaseUrl, config.nativePages, presentation, renewToken])

  useEffect(() => {
    let active = true
    const boot = async () => {
      const stored = storedAccessToken(config.realm)
      if (stored) {
        if (active) setToken(stored)
      } else {
        try {
          const session = await refreshAccessToken(config)
          if (!active) return
          setToken(session.accessToken)
          setPrincipal(session.principal)
        } catch {
          // No session yet: the login screen takes over.
        }
      }
      if (active) setBooting(false)
    }
    void boot()
    return () => { active = false }
  }, [config])

  useEffect(() => {
    if (!token) return
    let active = true
    setFailure('')
    const load = async () => {
      try {
        const loaded = await loadRegistry(hostConfig)
        if (active) setRegistry(loaded)
      } catch {
        clearAccessToken(config.realm)
        try {
          const session = await refreshAccessToken(config)
          if (!active) return
          setPrincipal(session.principal)
          setToken(session.accessToken)
        } catch {
          if (!active) return
          setToken('')
          setRegistry(undefined)
          setFailure('会话已失效，请重新登录')
        }
      }
    }
    void load()
    return () => { active = false }
  }, [token, hostConfig, config])

  useEffect(() => {
    if (!token || !registry) return
    let active = true
    return subscribeRegistryRefresh(
      async () => {
        const loaded = await loadRegistry(hostConfig)
        if (active) setRegistry((current) => current ? reconcileRegistryRefresh(current, loaded) : loaded)
      },
      (error) => {
        // Preserve the last valid navigation snapshot during a transient
        // outage; the next focus/visibility/interval signal retries it.
        if (active) console.warn('module registry refresh failed', error)
      },
    )
  }, [token, Boolean(registry), hostConfig])

  const pages = registry?.pages || []
  const activePage = pages.find((page) => page.route === route) || pages[0]
  const activeRoute = activePage?.route || ''

  useEffect(() => {
    if (!activePage) return
    setOpenTabs((tabs) => (tabs.some((tab) => tab.id === activePage.id) ? tabs : [...tabs, activePage]))
  }, [activePage])

  const navigate = useCallback((next: string) => { location.hash = next }, [])

  const closeTab = useCallback((page: HostPage) => {
    setOpenTabs((tabs) => {
      const index = tabs.findIndex((tab) => tab.id === page.id)
      if (index <= 0) return tabs
      const remaining = tabs.filter((tab) => tab.id !== page.id)
      // Closing the tab you are standing on falls back to its left neighbour.
      if (page.route === activeRoute) location.hash = remaining[index - 1].route
      return remaining
    })
  }, [activeRoute])

  const signOut = useCallback(() => {
    void logout(config).finally(() => {
      setToken('')
      setPrincipal(undefined)
      setRegistry(undefined)
      setOpenTabs([])
    })
  }, [config])

  if (booting) {
    return (
      <CenteredNotice>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在恢复会话…
        </span>
      </CenteredNotice>
    )
  }

  if (!token) {
    return (
      <LoginPage
        config={config}
        onAuthenticated={(session) => {
          setPrincipal(session.principal)
          setToken(session.accessToken)
        }}
      />
    )
  }

  if (!registry) {
    return (
      <CenteredNotice>
        {failure
          ? (
            <div className="flex flex-col items-center gap-3 text-sm text-danger">
              <AlertTriangle className="h-5 w-5" />
              {failure}
              <Button variant="outline" size="sm" onClick={signOut}>返回登录</Button>
            </div>
          )
          : (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载已注册模块…
            </span>
          )}
      </CenteredNotice>
    )
  }

  return (
    <ConsoleLayout
      surface={config.surface}
      title={presentation.title}
      subtitle={presentation.subtitle}
      principal={principal}
      pages={pages}
      openTabs={openTabs}
      activeRoute={activeRoute}
      onNavigate={navigate}
      onCloseTab={closeTab}
      onLogout={signOut}
    >
      <PageOutlet page={activePage} config={hostConfig} />
      {presentation.outlets.map((outlet) => (
        <OutletStrip key={outlet} outlet={outlet} items={registry.byOutlet.get(outlet) || []} config={hostConfig} />
      ))}
    </ConsoleLayout>
  )
}
