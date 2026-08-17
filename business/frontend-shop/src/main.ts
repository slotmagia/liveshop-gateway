import '@liveshop/design-tokens/storefront.css'
import '@liveshop/host-runtime/host.css'
import { mountStorefrontHost } from '@liveshop/host-runtime'

if (!location.hash) location.hash = '/'

void mountStorefrontHost(document.querySelector('#app')!, {
  surface: 'shop', title: 'LiveShop',
  realm: 'CUSTOMER',
  shopCode: import.meta.env.VITE_SHOP_CODE || 'local-shop',
  gatewayBaseUrl: import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18081',
  outlets: ['shop.home.hero', 'shop.product.grid', 'shop.checkout.payment-methods'],
})
