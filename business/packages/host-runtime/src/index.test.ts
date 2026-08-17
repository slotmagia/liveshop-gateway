// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { contributionPath, storefrontSection } from './index'

describe('contribution route matching', () => {
  it('matches the pathname while retaining query parameters in location.hash', () => {
    location.hash = '#/checkout?source=catalog&items=1%3A2'
    expect(contributionPath(location.hash)).toBe('/checkout')
    expect(location.hash).toContain('items=1%3A2')
  })

  it('handles plain contribution routes', () => {
    expect(contributionPath('#/catalog')).toBe('/catalog')
  })
})

describe('storefront navigation', () => {
  it('keeps secondary routes under their stable primary tab', () => {
    expect(storefrontSection('/product/detail')).toBe('/products')
    expect(storefrontSection('/live/detail')).toBe('/live')
    expect(storefrontSection('/checkout')).toBe('/cart')
    expect(storefrontSection('/orders/detail')).toBe('/profile')
  })
})
