export interface CapabilityField {
  name: string
  location?: string
  type: string
  format?: string
  required?: boolean
  description: string
  example?: string
}

export interface CapabilityResponse { status: number; description: string; fields: CapabilityField[] }
export interface HTTPOperation {
  id: string
  method: string
  path: string
  summary: string
  description: string
  authentication: string
  idempotency: string
  requiredPermissions: string[]
  requestFields: CapabilityField[]
  responses: CapabilityResponse[]
}
export interface HTTPRoute { surface: string; prefix: string; operations: HTTPOperation[] }
export interface GRPCMethod {
  name: string
  fullMethod: string
  summary: string
  description: string
  invocation: string
  idempotency: string
  recommendedDeadlineMs: number
  requiredPermissions: string[]
  requestFields: CapabilityField[]
  responseFields: CapabilityField[]
}
export interface GRPCContract { service: string; contractVersion: string; endpoint: string; transportSecurity: string; methods: GRPCMethod[] }
export interface PermissionDefinition { code: string; name: string; resource: string; action: string; description?: string }
export interface FrontendAction { id: string; label: string; description: string; invocation: string; target: string; parameters: CapabilityField[]; requiredPermissions: string[] }
export interface FrontendEvent { name: string; description: string; payload: CapabilityField[] }
export interface Contribution {
  id: string
  surface: string
  kind: string
  route?: string
  outlet?: string
  title: string
  description: string
  artifact: { type: string; name: string; version: string; entry: string; exportName?: string; integrity: string }
  frontend: { component: string; props: CapabilityField[]; events: FrontendEvent[]; actions: FrontendAction[] }
}
export interface CapabilityRelease {
  version: string
  digest: string
  active: boolean
  backend: { service: string; origin: string; httpRoutes: HTTPRoute[]; grpc?: GRPCContract }
  permissions: PermissionDefinition[]
  contributions: Contribution[]
}
export interface ModuleCatalog { id: string; name: string; activeVersion?: string; releases: CapabilityRelease[] }
export interface ModuleCatalogEnvelope { code: number; data: { revision: number; items: ModuleCatalog[] } }
