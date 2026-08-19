import '@liveshops/design-tokens/console.css'
import '@liveshops/design-tokens/tailwind.css'
import '@liveshop/host-runtime/host.css'
import { mountAuthenticatedConsoleHost } from '@liveshop/host-runtime/console'
import { mountModuleCatalog } from './views/module-catalog/ModuleCatalogPage'

mountAuthenticatedConsoleHost(document.querySelector('#app')!, {
  surface: 'admin',
  realm: 'PLATFORM',
  gatewayBaseUrl: import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18081',
  nativePages: [{ id: 'gateway.module-catalog', route: '/gateway/modules', title: '模块能力中心', description: '只读展示当前活动 Registry revision 的 HTTP、gRPC、前端贡献与权限契约。', sort: 0, render: mountModuleCatalog }],
})
