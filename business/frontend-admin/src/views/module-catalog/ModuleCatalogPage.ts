import type { NativePageContext } from '@liveshop/host-runtime'
import { emptyState, notify, ui } from '@liveshops/design-tokens'
import { fetchModuleCatalog } from './api/moduleCatalogApi'
import { renderModuleList, renderRelease } from './components/renderers'
import './components/moduleCatalog.css'

export async function mountModuleCatalog(root: HTMLElement, context: NativePageContext): Promise<void> {
  root.innerHTML = `<div class="${ui.empty}">正在加载模块能力目录…</div>`
  try {
    const token = await context.accessToken()
    const catalog = await fetchModuleCatalog(context.gatewayBaseUrl, token)
    let selectedID = catalog.items.find((item) => item.activeVersion)?.id || catalog.items[0]?.id || ''
    root.innerHTML = `<main class="${ui.page}"><section class="cap-center ${ui.card}"><aside class="cap-sidebar"><div class="cap-sidebar__heading"><span>ACTIVE MODULES</span><h2>活动能力目录</h2><p>Identity 投影 · 契约驱动</p></div><label class="cap-search"><span>搜索模块</span><input class="${ui.input}" type="search" placeholder="module id / name" data-search></label><div data-module-list></div></aside><article class="cap-detail" data-detail></article></section></main>`
    const listRoot = root.querySelector<HTMLElement>('[data-module-list]')!
    const detailRoot = root.querySelector<HTMLElement>('[data-detail]')!
    const search = root.querySelector<HTMLInputElement>('[data-search]')!
    const render = () => {
      const module = catalog.items.find((item) => item.id === selectedID)
      listRoot.innerHTML = renderModuleList(catalog.items, selectedID, search.value)
      listRoot.querySelectorAll<HTMLButtonElement>('[data-module-id]').forEach((button) => button.addEventListener('click', () => {
        selectedID = button.dataset.moduleId || ''
        render()
      }))
      if (!module) {
        detailRoot.innerHTML = `<div class="${ui.empty}">尚未注册模块发布</div>`
        return
      }
      const release = module.releases.find((item) => item.active && item.version === module.activeVersion)
      if (!release) {
        detailRoot.innerHTML = `<div class="${ui.empty}">Identity 未返回该模块的活动能力快照</div>`
        return
      }
      detailRoot.innerHTML = renderRelease(module, release, catalog.revision)
    }
    search.addEventListener('input', render)
    render()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    notify(message, 'danger')
    root.replaceChildren(emptyState(message))
  }
}
