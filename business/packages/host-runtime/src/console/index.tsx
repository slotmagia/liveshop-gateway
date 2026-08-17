/**
 * The React entry for the two back-office consoles. Hosts keep calling one
 * imperative function, so a surface's `main.ts` stays a mount point rather than
 * an application.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConsoleApp } from './ConsoleApp'
import type { AuthenticatedConsoleHostConfig } from '../runtime'

export function mountAuthenticatedConsoleHost(root: HTMLElement, config: AuthenticatedConsoleHostConfig): void {
  document.documentElement.classList.add('ls-console-host-root')
  root.classList.add('ls-console-host-mount')
  createRoot(root).render(
    <StrictMode>
      <ConsoleApp config={config} />
    </StrictMode>,
  )
}

export { ConsoleApp } from './ConsoleApp'
export { ConsoleLayout } from './ConsoleLayout'
export { LoginPage } from './LoginPage'
export { OutletStrip, PageOutlet } from './PageOutlet'
export * from '../ui'
export type {
  AuthenticatedConsoleHostConfig,
  ConsoleSurface,
  HostConfig,
  HostPage,
  NativeConsolePage,
  NativePageContext,
  Principal,
  Session,
} from '../runtime'
