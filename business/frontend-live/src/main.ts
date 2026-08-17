import '@liveshop/design-tokens/storefront.css'
import '@liveshop/host-runtime/host.css'
import { mountStorefrontHost } from '@liveshop/host-runtime'

void mountStorefrontHost(document.querySelector('#app')!, {
  surface: 'live', title: 'LiveShop Live Viewer',
  realm: 'CUSTOMER',
  shopCode: import.meta.env.VITE_SHOP_CODE || 'local-shop',
  gatewayBaseUrl: import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18081',
  outlets: ['live.player.overlay', 'live.room.product-panel', 'live.room.interaction-panel'],
})
