export const LOCALE_STORAGE_KEY = 'liveshop.locale'
const SHOP_LOCALE_META_KEY = 'liveshop.shop-locale-meta'

export function normalizeLocale(raw?: string | null): string {
  const value = (raw || '').trim()
  if (!value) return 'zh-CN'
  const lower = value.toLowerCase().replaceAll('_', '-')
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('en')) return 'en-US'
  return 'zh-CN'
}

export function storedLocale(): string | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY)
    return value ? normalizeLocale(value) : null
  } catch {
    return null
  }
}

export function persistLocale(locale: string): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, normalizeLocale(locale))
  } catch {
    // Host still works when storage is unavailable.
  }
}

export function persistShopLocaleMeta(input: { publishedLocales?: string[]; defaultLocale?: string }): void {
  try {
    sessionStorage.setItem(SHOP_LOCALE_META_KEY, JSON.stringify({
      defaultLocale: normalizeLocale(input.defaultLocale || 'zh-CN'),
      publishedLocales: (input.publishedLocales || []).map(normalizeLocale),
    }))
  } catch {
    // Host still works when storage is unavailable.
  }
}

export function shopLocaleMeta(): { publishedLocales?: string[]; defaultLocale?: string } {
  try {
    const raw = sessionStorage.getItem(SHOP_LOCALE_META_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { publishedLocales?: string[]; defaultLocale?: string }
    return {
      defaultLocale: parsed.defaultLocale,
      publishedLocales: parsed.publishedLocales,
    }
  } catch {
    return {}
  }
}

export function resolveHostLocale(input: {
  surface: string
  publishedLocales?: string[]
  defaultLocale?: string
}): string {
  const user = storedLocale()
  const browser = normalizeLocale(typeof navigator === 'undefined' ? 'zh-CN' : navigator.language)
  if (input.surface === 'shop' || input.surface === 'live') {
    const published = (input.publishedLocales || []).map(normalizeLocale)
    const fallback = normalizeLocale(input.defaultLocale || 'zh-CN')
    if (user && (published.length === 0 || published.includes(user))) return user
    if (published.includes(browser)) return browser
    if (published.includes(fallback)) return fallback
    if (published.length) return published[0]
    return fallback
  }
  return user || browser || 'zh-CN'
}
