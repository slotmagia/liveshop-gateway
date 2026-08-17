import {
  HOST_PROTOCOL,
  type HostFormModalChangeMessage,
  type HostFormModalClosedMessage,
  type HostFormModalCommandMessage,
  type HostFormModalOpenMessage,
  type HostFormModalRequestMessage,
  type HostModalField,
  type HostModalTreeNode,
} from '@liveshop/host-sdk'
import { formModal, type FormModalApi } from '@liveshop/design-tokens'

export interface HostModalOwner {
  postMessage(message: unknown, targetOrigin: string): void
}

interface ActiveHostModal {
  owner: HostModalOwner
  origin: string
  requestId: string
  dialog: FormModalApi
  title: string
  submitLabel: string
  cancelLabel: string
  busy: boolean
}

let active: ActiveHostModal | undefined

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function boundedText(value: unknown, maximum: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, maximum) : fallback
}

function scalar(value: unknown): string | number | undefined {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : undefined
}

function sanitizeTree(value: unknown, depth = 0, budget = { count: 0 }): HostModalTreeNode[] | undefined {
  if (!Array.isArray(value) || depth > 4) return undefined
  const nodes: HostModalTreeNode[] = []
  for (const entry of value.slice(0, 500)) {
    if (budget.count >= 2_000) break
    const source = record(entry)
    if (!source) return undefined
    const id = boundedText(source.id, 160).trim()
    const label = boundedText(source.label, 300).trim()
    if (!id || !label) return undefined
    budget.count += 1
    const node: HostModalTreeNode = {
      id,
      label,
      description: boundedText(source.description, 500) || undefined,
    }
    const nodeValue = scalar(source.value)
    if (nodeValue !== undefined) node.value = nodeValue
    if (source.children !== undefined) {
      const children = sanitizeTree(source.children, depth + 1, budget)
      if (!children) return undefined
      node.children = children
    }
    nodes.push(node)
  }
  return nodes
}

function sanitizeField(value: unknown): HostModalField | undefined {
  const source = record(value)
  if (!source) return undefined
  const name = boundedText(source.name, 80).trim()
  if (!name) return undefined
  const kinds = new Set(['input', 'select', 'textarea', 'date-range', 'checkbox-tree'])
  const inputTypes = new Set(['text', 'password', 'number', 'email', 'url', 'tel', 'date', 'datetime-local', 'time'])
  const kind = typeof source.kind === 'string' && kinds.has(source.kind) ? source.kind as HostModalField['kind'] : undefined
  const type = typeof source.type === 'string' && inputTypes.has(source.type) ? source.type : undefined
  const field: HostModalField = {
    name,
    label: boundedText(source.label, 200),
    kind,
    type,
    value: scalar(source.value),
    placeholder: boundedText(source.placeholder, 300),
    required: source.required === true,
    disabled: source.disabled === true,
    wide: source.wide === true,
    mono: source.mono === true,
    rows: positiveInteger(source.rows, 30),
    min: scalar(source.min),
    max: scalar(source.max),
    step: scalar(source.step),
    minLength: positiveInteger(source.minLength, 10_000),
    maxLength: positiveInteger(source.maxLength, 10_000),
    autocomplete: boundedText(source.autocomplete, 80),
    from: boundedText(source.from, 80),
    to: boundedText(source.to, 80),
    fromValue: scalar(source.fromValue),
    toValue: scalar(source.toValue),
    separator: boundedText(source.separator, 20),
    empty: boundedText(source.empty, 300),
  }
  if (source.span === 1 || source.span === 2) field.span = source.span
  if (source.columns === 2 || source.columns === 3) field.columns = source.columns
  if (Array.isArray(source.options)) {
    const options: NonNullable<HostModalField['options']> = []
    for (const option of source.options.slice(0, 100)) {
      if (typeof option === 'string') {
        options.push(option.slice(0, 300))
        continue
      }
      const item = record(option)
      const optionValue = scalar(item?.value)
      if (optionValue !== undefined) options.push({ value: optionValue, label: boundedText(item?.label, 300) || undefined })
    }
    field.options = options
  }
  if (kind === 'checkbox-tree') {
    const tree = sanitizeTree(source.tree)
    if (!tree) return undefined
    field.tree = tree
  }
  return field
}

/** Validate and bound data supplied by an independently deployed iframe. */
export function parseHostFormModalOpenMessage(value: unknown): HostFormModalOpenMessage | undefined {
  const source = record(value)
  if (!source || source.type !== 'LIVESHOP_HOST_FORM_MODAL_OPEN' || source.protocol !== HOST_PROTOCOL) return undefined
  const requestId = boundedText(source.requestId, 80).trim()
  if (!/^[A-Za-z0-9-]{8,80}$/.test(requestId) || !Array.isArray(source.fields) || source.fields.length > 32) return undefined
  const fields = source.fields.map(sanitizeField)
  if (fields.some((field) => !field)) return undefined
  const names = fields.map((field) => field!.name)
  if (new Set(names).size !== names.length) return undefined
  const suppliedValues = record(source.values) || {}
  const values: HostFormModalOpenMessage['values'] = {}
  for (const name of names) {
    const valueAtName = suppliedValues[name]
    if (valueAtName === null || valueAtName === undefined || typeof valueAtName === 'string' || typeof valueAtName === 'number') {
      values[name] = valueAtName as string | number | null | undefined
    }
  }
  return {
    type: 'LIVESHOP_HOST_FORM_MODAL_OPEN',
    protocol: HOST_PROTOCOL,
    requestId,
    title: boundedText(source.title, 200),
    fields: fields as HostModalField[],
    values,
    submitLabel: boundedText(source.submitLabel, 80, '保存') || '保存',
    cancelLabel: boundedText(source.cancelLabel, 80, '取消') || '取消',
    busy: source.busy === true,
  }
}

function post(owner: HostModalOwner, origin: string, message: HostFormModalClosedMessage | HostFormModalChangeMessage | {
  type: 'LIVESHOP_HOST_FORM_MODAL_SUBMIT'
  protocol: typeof HOST_PROTOCOL
  requestId: string
  values: Record<string, string>
}): void {
  try {
    owner.postMessage(message, origin)
  } catch {
    // A detached iframe has no receiver; Host cleanup must still complete.
  }
}

function setHostModalOpen(open: boolean): void {
  document.documentElement.classList.toggle('ls-host--modal-open', open)
}

function closeActive(reason: HostFormModalClosedMessage['reason']): void {
  const closing = active
  if (!closing) return
  active = undefined
  setHostModalOpen(false)
  closing.dialog.close()
  post(closing.owner, closing.origin, {
    type: 'LIVESHOP_HOST_FORM_MODAL_CLOSED',
    protocol: HOST_PROTOCOL,
    requestId: closing.requestId,
    reason,
  })
}

function open(owner: HostModalOwner, origin: string, request: HostFormModalOpenMessage): void {
  if (active) closeActive('replaced')
  let state: ActiveHostModal
  const dialog = formModal({
    title: request.title,
    fields: request.fields,
    submitLabel: request.submitLabel,
    cancelLabel: request.cancelLabel,
    onSubmit(values) {
      post(owner, origin, {
        type: 'LIVESHOP_HOST_FORM_MODAL_SUBMIT',
        protocol: HOST_PROTOCOL,
        requestId: request.requestId,
        values,
      })
    },
    onClose() {
      if (active !== state) return
      active = undefined
      setHostModalOpen(false)
      post(owner, origin, {
        type: 'LIVESHOP_HOST_FORM_MODAL_CLOSED',
        protocol: HOST_PROTOCOL,
        requestId: request.requestId,
        reason: 'dismissed',
      })
    },
  })
  dialog.form.element.addEventListener('change', (event) => {
    if (active !== state) return
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    post(owner, origin, {
      type: 'LIVESHOP_HOST_FORM_MODAL_CHANGE',
      protocol: HOST_PROTOCOL,
      requestId: request.requestId,
      field: boundedText(target?.name, 80),
      values: dialog.form.values(),
    })
  })
  state = {
    owner, origin, requestId: request.requestId, dialog,
    title: request.title, submitLabel: request.submitLabel, cancelLabel: request.cancelLabel, busy: request.busy,
  }
  active = state
  setHostModalOpen(true)
  dialog.open(request.values, request.title)
  dialog.setBusy(request.busy)
}

function replaceFields(current: ActiveHostModal, fields: HostModalField[], values: HostFormModalOpenMessage['values'], title: string): void {
  if (active !== current) return
  const request: HostFormModalOpenMessage = {
    type: 'LIVESHOP_HOST_FORM_MODAL_OPEN', protocol: HOST_PROTOCOL, requestId: current.requestId,
    title, fields, values, submitLabel: current.submitLabel, cancelLabel: current.cancelLabel, busy: current.busy,
  }
  active = undefined
  current.dialog.close()
  open(current.owner, current.origin, request)
}

function command(owner: HostModalOwner, value: unknown): boolean {
  const message = record(value)
  if (!message || message.type !== 'LIVESHOP_HOST_FORM_MODAL_COMMAND' || message.protocol !== HOST_PROTOCOL) return false
  if (!active || active.owner !== owner || active.requestId !== message.requestId) return true
  const action = message.command as HostFormModalCommandMessage['command']
  if (action === 'close') closeActive('programmatic')
  else if (action === 'set-busy') {
    active.busy = message.busy === true
    active.dialog.setBusy(active.busy)
  }
  else if (action === 'set-title') {
    active.title = boundedText(message.title, 200)
    active.dialog.setTitle(active.title)
  }
  else if (action === 'set-error') active.dialog.setError(boundedText(message.message, 2_000))
  else if (action === 'set-fields') {
    if (!Array.isArray(message.fields) || message.fields.length > 32) return true
    const fields = message.fields.map(sanitizeField)
    if (fields.some(field => !field)) return true
    const names = fields.map(field => field!.name)
    if (new Set(names).size !== names.length) return true
    const suppliedValues = record(message.values) || {}
    const values: HostFormModalOpenMessage['values'] = {}
    for (const name of names) {
      const valueAtName = suppliedValues[name]
      if (valueAtName === null || valueAtName === undefined || typeof valueAtName === 'string' || typeof valueAtName === 'number') {
        values[name] = valueAtName as string | number | null | undefined
      }
    }
    const current = active
    replaceFields(current, fields as HostModalField[], values, boundedText(message.title, 200, current.title) || current.title)
  }
  return true
}

export function handleHostFormModalMessage(owner: HostModalOwner, origin: string, value: unknown): boolean {
  const request = parseHostFormModalOpenMessage(value)
  if (request) {
    open(owner, origin, request)
    return true
  }
  return command(owner, value as HostFormModalRequestMessage)
}

export function disposeHostFormModalOwner(owner: HostModalOwner): void {
  if (active?.owner === owner) closeActive('owner-unmounted')
}
