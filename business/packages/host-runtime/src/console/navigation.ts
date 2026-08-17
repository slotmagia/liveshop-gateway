import type { HostPage } from '../runtime'

export interface NavigationGroup {
  id: string
  title: string
  icon?: string
  sort: number
  pages: HostPage[]
}

const WORKBENCH_GROUP = { groupId: 'host-workbench', groupTitle: '工作台', groupIcon: 'layout-dashboard', groupSort: 0 }

export function groupNavigationPages(pages: HostPage[]): NavigationGroup[] {
  const groups = new Map<string, NavigationGroup>()
  for (const page of pages) {
    const metadata = page.navigation || WORKBENCH_GROUP
    const existing = groups.get(metadata.groupId)
    if (existing) {
      existing.pages.push(page)
      continue
    }
    groups.set(metadata.groupId, {
      id: metadata.groupId,
      title: metadata.groupTitle,
      icon: metadata.groupIcon,
      sort: metadata.groupSort,
      pages: [page],
    })
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      pages: group.pages.sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id))
}
