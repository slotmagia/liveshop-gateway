import { describe, expect, it } from 'vitest'
import type { HostPage } from '../runtime'
import { groupNavigationPages } from './navigation'

describe('console navigation grouping', () => {
  it('keeps native pages in the workbench and groups module pages', () => {
    const pages: HostPage[] = [
      { id: 'platform.settings', route: '/settings', title: '平台配置', description: '平台配置说明', sort: 20 },
      { id: 'trade.payments', route: '/trade/payments', title: '支付管理', description: '支付管理说明', sort: 120, navigation: { groupId: 'trade', groupTitle: 'Trade 管理', groupSort: 100 } },
      { id: 'trade.orders', route: '/trade/orders', title: '订单管理', description: '订单管理说明', sort: 110, navigation: { groupId: 'trade', groupTitle: 'Trade 管理', groupSort: 100 } },
    ]

    const groups = groupNavigationPages(pages)
    expect(groups.map((group) => group.title)).toEqual(['工作台', 'Trade 管理'])
    expect(groups[1].pages.map((page) => page.id)).toEqual(['trade.orders', 'trade.payments'])
  })
})
