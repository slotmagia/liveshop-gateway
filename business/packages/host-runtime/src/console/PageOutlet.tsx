import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { mountContribution, type ContributionDisposer, type HostConfig, type HostPage, type RuntimeContribution } from '../runtime'
import { Card, CardDescription, CardHeader } from '../ui/card'

/**
 * The seam between React and everything a module ships. Pages are still mounted
 * imperatively — a registered contribution is an iframe or a remote ESM bundle,
 * and a native page is a plain `render(container)` — so this component owns a
 * detached container and never lets React reconcile a module's DOM.
 */
export function PageOutlet({ page, config }: { page?: HostPage; config: HostConfig }) {
  const container = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const host = container.current
    if (!host) return
    let active = true
    let resetFrame = 0
    const resetPageScroll = () => {
      const scroller = host.closest<HTMLElement>('[data-page-scroll-container]')
      if (!scroller) return
      scroller.scrollTop = 0
      scroller.scrollLeft = 0
    }
    const settlePageScroll = () => {
      resetPageScroll()
      window.cancelAnimationFrame(resetFrame)
      resetFrame = window.requestAnimationFrame(resetPageScroll)
    }
    settlePageScroll()
    host.replaceChildren()
    if (!page) return () => {
      active = false
      window.cancelAnimationFrame(resetFrame)
    }
    let dispose: ContributionDisposer | undefined
    setPending(true)
    const mount = async () => {
      if (page.contribution) {
        const mounted = await mountContribution(host, config, page.contribution, () => {
          if (active) settlePageScroll()
        })
        if (active) dispose = mounted
        else await mounted()
      }
      else if (page.native) await page.native.render(host, { gatewayBaseUrl: config.gatewayBaseUrl, accessToken: config.accessToken })
    }
    void mount().finally(() => {
      if (!active) return
      setPending(false)
      // Initial URL restoration and iframe mounting may run after the layout
      // route effect. Reset again when the contribution is actually present.
      settlePageScroll()
    })
    return () => {
      active = false
      window.cancelAnimationFrame(resetFrame)
      void dispose?.()
      host.replaceChildren()
    }
  }, [page, config])

  return (
    <div className="relative">
      {page && (
        <Card className="mb-3" data-page-summary>
          <CardHeader className="space-y-2 px-5 py-5">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">{page.title}</h1>
            <CardDescription className="text-base leading-6">{page.description}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {pending && (
        <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载页面…
        </div>
      )}
      <div ref={container} className="ls-console-page" />
    </div>
  )
}

/** Dashboard slots. Each registered widget mounts once, in registry order. */
export function OutletStrip({ outlet, items, config }: { outlet: string; items: RuntimeContribution[]; config: HostConfig }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = container.current
    if (!host) return
    host.replaceChildren()
    let active = true
    const disposers: ContributionDisposer[] = []
    const mount = async () => {
      for (const item of items) {
        if (!active) return
        const target = document.createElement('div')
        target.className = 'ls-card'
        host.append(target)
        const dispose = await mountContribution(target, config, item)
        if (active) disposers.push(dispose)
        else await dispose()
      }
    }
    void mount()
    return () => {
      active = false
      for (const dispose of disposers) void dispose()
      host.replaceChildren()
    }
  }, [items, config])

  if (items.length === 0) return null
  return <section className="mb-2" data-outlet={outlet}><div ref={container} /></section>
}
