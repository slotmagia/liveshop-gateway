import type {
  CapabilityField,
  CapabilityRelease,
  CapabilityResponse,
  Contribution,
  FrontendAction,
  FrontendEvent,
  GRPCContract,
  GRPCMethod,
  HTTPOperation,
  HTTPRoute,
  ModuleCatalog,
  ModuleCatalogEnvelope,
} from '../types'

type NullableArray<T> = T[] | null | undefined

const array = <T>(value: NullableArray<T>): T[] => Array.isArray(value) ? value : []
const fields = (value: NullableArray<CapabilityField>): CapabilityField[] => array(value)

function normalizeResponse(response: CapabilityResponse): CapabilityResponse {
  return { ...response, fields: fields(response.fields) }
}

function normalizeHTTPOperation(operation: HTTPOperation): HTTPOperation {
  return {
    ...operation,
    requiredPermissions: array(operation.requiredPermissions),
    requestFields: fields(operation.requestFields),
    responses: array(operation.responses).map(normalizeResponse),
  }
}

function normalizeHTTPRoute(route: HTTPRoute): HTTPRoute {
  return { ...route, operations: array(route.operations).map(normalizeHTTPOperation) }
}

function normalizeGRPCMethod(method: GRPCMethod): GRPCMethod {
  return {
    ...method,
    requiredPermissions: array(method.requiredPermissions),
    requestFields: fields(method.requestFields),
    responseFields: fields(method.responseFields),
  }
}

function normalizeGRPCContract(contract: GRPCContract): GRPCContract {
  return { ...contract, methods: array(contract.methods).map(normalizeGRPCMethod) }
}

function normalizeFrontendEvent(event: FrontendEvent): FrontendEvent {
  return { ...event, payload: fields(event.payload) }
}

function normalizeFrontendAction(action: FrontendAction): FrontendAction {
  return {
    ...action,
    parameters: fields(action.parameters),
    requiredPermissions: array(action.requiredPermissions),
  }
}

function normalizeContribution(contribution: Contribution): Contribution {
  return {
    ...contribution,
    frontend: {
      ...contribution.frontend,
      props: fields(contribution.frontend.props),
      events: array(contribution.frontend.events).map(normalizeFrontendEvent),
      actions: array(contribution.frontend.actions).map(normalizeFrontendAction),
    },
  }
}

function normalizeRelease(release: CapabilityRelease): CapabilityRelease {
  return {
    ...release,
    backend: {
      ...release.backend,
      httpRoutes: array(release.backend.httpRoutes).map(normalizeHTTPRoute),
      grpc: release.backend.grpc ? normalizeGRPCContract(release.backend.grpc) : undefined,
    },
    permissions: array(release.permissions),
    contributions: array(release.contributions).map(normalizeContribution),
  }
}

function normalizeModule(module: ModuleCatalog): ModuleCatalog {
  return { ...module, releases: array(module.releases).map(normalizeRelease) }
}

export function normalizeModuleCatalog(data: ModuleCatalogEnvelope['data'] | null | undefined): ModuleCatalogEnvelope['data'] {
  if (!data || !Number.isFinite(data.revision)) throw new Error('模块能力目录响应格式无效')
  return { ...data, items: array(data.items).map(normalizeModule) }
}

export async function fetchModuleCatalog(gatewayBaseUrl: string, accessToken: string): Promise<ModuleCatalogEnvelope['data']> {
  const response = await fetch(`${gatewayBaseUrl}/runtime/v1/module-catalog`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Liveshop-Surface': 'admin' },
  })
  const body = await response.json() as ModuleCatalogEnvelope & { message?: string }
  if (!response.ok || body.code !== 0) throw new Error(body.message || '模块能力目录加载失败')
  return normalizeModuleCatalog(body.data)
}
