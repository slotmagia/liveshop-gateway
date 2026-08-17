import { describe, expect, it } from 'vitest'
import { groupNavIcon, pageNavIcon } from './icons'

describe('console navigation icons', () => {
  it('resolves distinct icons for registered directories and menus', () => {
    const roles = pageNavIcon({ id: 'identity.admin.authorization', route: '/roles', title: '角色管理', description: '', icon: 'shield-check', sort: 1 })
    const menus = pageNavIcon({ id: 'platform.admin.registry', route: '/menus', title: '菜单管理', description: '', icon: 'panel-left', sort: 2 })
    const merchants = pageNavIcon({ id: 'identity.admin.directory', route: '/merchants', title: '商户管理', description: '', icon: 'building-2', sort: 3 })
    expect(roles.displayName).toBe('ShieldCheck')
    expect(menus.displayName).toBe('PanelLeft')
    expect(merchants.displayName).toBe('Building2')
    expect(new Set([roles, menus, merchants]).size).toBe(3)
    expect(groupNavIcon('legacy-admin-system', 'shield').displayName).toBe('Shield')
    expect(groupNavIcon('legacy-admin-mall', 'store').displayName).toBe('Store')
    expect(groupNavIcon('legacy-admin-system', 'shield')).not.toBe(groupNavIcon('legacy-admin-mall', 'store'))
  })
})
