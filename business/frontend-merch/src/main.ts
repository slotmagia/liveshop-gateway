import '@liveshops/design-tokens/console.css'
import '@liveshops/design-tokens/tailwind.css'
import '@liveshop/host-runtime/host.css'
import { mountAuthenticatedConsoleHost } from '@liveshop/host-runtime/console'

mountAuthenticatedConsoleHost(document.querySelector('#app')!, {
  surface: 'merch',
  realm: 'MERCHANT',
  gatewayBaseUrl: import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18081',
})
