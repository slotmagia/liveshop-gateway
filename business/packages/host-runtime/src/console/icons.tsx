import { resolveGroupIconName, resolvePageIconName } from '@liveshop/design-tokens'
import * as LucideIcons from 'lucide-react'
import { FolderKanban, LayoutGrid, type LucideIcon } from 'lucide-react'
import type { HostPage } from '../runtime'

function pascalCase(name: string): string {
  return name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

function isLucideIcon(value: unknown): value is LucideIcon {
  if (typeof value === 'function') return true
  if (!value || typeof value !== 'object') return false
  const candidate = value as { $$typeof?: unknown; displayName?: string }
  return Boolean(candidate.$$typeof || candidate.displayName)
}

function lucideIcon(name: string, fallback: LucideIcon): LucideIcon {
  const candidate = (LucideIcons as Record<string, unknown>)[pascalCase(name)]
  return isLucideIcon(candidate) ? candidate : fallback
}

export function pageNavIcon(page: HostPage): LucideIcon {
  return lucideIcon(resolvePageIconName(page.id, page.icon), LayoutGrid)
}

export function groupNavIcon(groupId: string, explicit?: string): LucideIcon {
  return lucideIcon(resolveGroupIconName(groupId, explicit), FolderKanban)
}
