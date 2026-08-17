import { describe, expect, it } from 'vitest'
import { renderRelease } from '../components/renderers'
import type { ModuleCatalogEnvelope } from '../types'
import { normalizeModuleCatalog } from './moduleCatalogApi'

describe('module catalog response normalization', () => {
  it('turns nullable capability collections into empty arrays before rendering', () => {
    const raw = {
      revision: 42,
      items: [{
        id: 'catalog',
        name: 'Catalog',
        activeVersion: '1.0.0',
        releases: [{
          version: '1.0.0',
          digest: 'sha256:test',
          active: true,
          backend: {
            service: 'catalog',
            origin: 'http://catalog:18090',
            grpc: null,
            httpRoutes: [{
              surface: 'shop',
              prefix: '/shop/catalog',
              operations: [{
                id: 'catalog.list',
                method: 'GET',
                path: '/products',
                summary: 'List products',
                description: 'Lists products.',
                authentication: 'bearer',
                idempotency: 'safe',
                requiredPermissions: null,
                requestFields: null,
                responses: [{ status: 200, description: 'OK', fields: null }],
              }],
            }],
          },
          permissions: null,
          contributions: null,
        }],
      }],
    } as unknown as ModuleCatalogEnvelope['data']

    const normalized = normalizeModuleCatalog(raw)
    const module = normalized.items[0]
    const release = module.releases[0]
    const operation = release.backend.httpRoutes[0].operations[0]

    expect(operation.requiredPermissions).toEqual([])
    expect(operation.requestFields).toEqual([])
    expect(operation.responses[0].fields).toEqual([])
    expect(release.permissions).toEqual([])
    expect(release.contributions).toEqual([])
    expect(() => renderRelease(module, release, normalized.revision)).not.toThrow()
  })

  it('rejects a missing data envelope instead of surfacing a property error', () => {
    expect(() => normalizeModuleCatalog(null)).toThrow('模块能力目录响应格式无效')
  })
})
