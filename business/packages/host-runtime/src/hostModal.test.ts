// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOST_PROTOCOL, type HostFormModalOpenMessage } from '@liveshops/host-sdk'
import {
  disposeHostFormModalOwner,
  handleHostFormModalMessage,
  parseHostFormModalOpenMessage,
  type HostModalOwner,
} from './hostModal'

interface SentMessage {
  message: Record<string, unknown>
  origin: string
}

const owners: HostModalOwner[] = []

function owner(): { target: HostModalOwner; sent: SentMessage[] } {
  const sent: SentMessage[] = []
  const target: HostModalOwner = {
    postMessage(message, origin) {
      sent.push({ message: message as Record<string, unknown>, origin })
    },
  }
  owners.push(target)
  return { target, sent }
}

function openMessage(requestId = 'request-0001'): HostFormModalOpenMessage {
  return {
    type: 'LIVESHOP_HOST_FORM_MODAL_OPEN',
    protocol: HOST_PROTOCOL,
    requestId,
    title: '编辑账户',
    fields: [
      { name: 'username', label: '账号', required: true },
      { name: 'status', label: '状态', kind: 'select', options: ['ACTIVE', 'DISABLED'] },
    ],
    values: { username: 'alice', status: 'ACTIVE', ignored: 'not-a-field' },
    submitLabel: '保存',
    cancelLabel: '取消',
    busy: false,
  }
}

beforeEach(() => {
  document.documentElement.className = ''
  document.body.innerHTML = '<div id="app"><button type="button">behind</button></div>'
})

afterEach(() => {
  for (const target of owners.splice(0)) disposeHostFormModalOwner(target)
  document.body.replaceChildren()
  document.documentElement.className = ''
})

describe('Host form modal protocol', () => {
  it('rejects malformed and ambiguous field declarations', () => {
    expect(parseHostFormModalOpenMessage({ ...openMessage(), requestId: 'x' })).toBeUndefined()
    expect(parseHostFormModalOpenMessage({
      ...openMessage(),
      fields: [{ name: 'same' }, { name: 'same' }],
    })).toBeUndefined()
  })

  it('renders the modal in the Host document and only accepts declared values', () => {
    const { target } = owner()
    expect(handleHostFormModalMessage(target, 'https://module.example', openMessage())).toBe(true)
    expect(document.body.querySelector('.ls-ui-modal-backdrop')).not.toBeNull()
    expect(document.body.querySelector('.ls-ui-modal-title')?.textContent).toBe('编辑账户')
    const modal = document.body.querySelector('.ls-ui-modal')
    expect([...modal!.children].map((child) => child.className)).toEqual([
      'ls-ui-modal-header',
      'ls-ui-modal-body',
      'ls-ui-modal-footer',
    ])
    expect(modal!.querySelector('.ls-ui-modal-body form')).not.toBeNull()
    expect(modal!.querySelectorAll('.ls-ui-modal-footer button')).toHaveLength(2)
    expect((document.querySelector('#app') as HTMLElement).inert).toBe(true)
    expect(document.documentElement.classList.contains('ls-host--modal-open')).toBe(true)
    expect((document.querySelector('[name="username"]') as HTMLInputElement).value).toBe('alice')
    expect(document.querySelector('[name="ignored"]')).toBeNull()
  })

  it('renders and submits a sanitized hierarchical checkbox tree', () => {
    const { target, sent } = owner()
    const message: HostFormModalOpenMessage = {
      ...openMessage(),
      title: '权限配置',
      fields: [{
        name: 'permissionCodes',
        label: '授权权限',
        kind: 'checkbox-tree',
        tree: [{
          id: 'module:catalog',
          label: 'catalog',
          children: [{
            id: 'resource:catalog:product',
            label: 'product',
            children: [
              { id: 'permission:read', label: '读取商品', value: 'catalog.product.read' },
              { id: 'permission:write', label: '编辑商品', value: 'catalog.product.write' },
            ],
          }],
        }],
      }],
      values: { permissionCodes: 'catalog.product.read' },
    }
    expect(handleHostFormModalMessage(target, 'https://module.example', message)).toBe(true)
    const tree = document.querySelector('[data-name="permissionCodes"]') as HTMLDivElement
    const value = tree.querySelector('[name="permissionCodes"]') as HTMLInputElement
    const checks = [...tree.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(checks).toHaveLength(4)
    expect(checks[0].indeterminate).toBe(true)
    expect(checks[2].checked).toBe(true)
    expect(checks[3].checked).toBe(false)

    checks[0].click()
    expect(value.value).toBe('catalog.product.read\ncatalog.product.write')
    tree.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(sent.at(-1)?.message).toMatchObject({
      type: 'LIVESHOP_HOST_FORM_MODAL_SUBMIT',
      values: { permissionCodes: 'catalog.product.read\ncatalog.product.write' },
    })
  })

  it('keeps a flat checkbox catalog in three shared columns', () => {
    const { target } = owner()
    expect(handleHostFormModalMessage(target, 'https://module.example', {
      ...openMessage(),
      fields: [{
        name: 'dialCodes',
        label: '区域',
        kind: 'checkbox-tree',
        columns: 3,
        tree: [
          { id: '+86', label: '中国大陆', value: '+86' },
          { id: '+1', label: '美国/加拿大', value: '+1' },
          { id: '+81', label: '日本', value: '+81' },
        ],
      }],
    })).toBe(true)
    const tree = document.querySelector('[data-name="dialCodes"]') as HTMLDivElement
    expect(tree.dataset.columns).toBe('3')
    expect(tree.querySelectorAll('input[type="checkbox"]')).toHaveLength(3)
  })

  it('routes submit and commands only to the owning iframe request', () => {
    const first = owner()
    const stranger = owner()
    handleHostFormModalMessage(first.target, 'https://module.example', openMessage())

    handleHostFormModalMessage(stranger.target, 'https://other.example', {
      type: 'LIVESHOP_HOST_FORM_MODAL_COMMAND', protocol: HOST_PROTOCOL, requestId: 'request-0001', command: 'close',
    })
    expect(document.body.querySelector('.ls-ui-modal-backdrop')).not.toBeNull()

    const username = document.querySelector('[name="username"]') as HTMLInputElement
    username.value = 'bob'
    username.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(first.sent.at(-1)).toEqual({
      origin: 'https://module.example',
      message: {
        type: 'LIVESHOP_HOST_FORM_MODAL_SUBMIT',
        protocol: HOST_PROTOCOL,
        requestId: 'request-0001',
        values: { username: 'bob', status: 'ACTIVE' },
      },
    })

    handleHostFormModalMessage(first.target, 'https://module.example', {
      type: 'LIVESHOP_HOST_FORM_MODAL_COMMAND', protocol: HOST_PROTOCOL, requestId: 'request-0001', command: 'set-error', message: '保存失败',
    })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('保存失败')
  })

  it('reports field changes and replaces dependent fields inside the same request', () => {
    const current = owner()
    handleHostFormModalMessage(current.target, 'https://module.example', openMessage())

    const status = document.querySelector('[name="status"]') as HTMLSelectElement
    status.value = 'DISABLED'
    status.dispatchEvent(new Event('change', { bubbles: true }))
    expect(current.sent.at(-1)).toEqual({
      origin: 'https://module.example',
      message: {
        type: 'LIVESHOP_HOST_FORM_MODAL_CHANGE',
        protocol: HOST_PROTOCOL,
        requestId: 'request-0001',
        field: 'status',
        values: { username: 'alice', status: 'DISABLED' },
      },
    })

    current.sent.length = 0
    expect(handleHostFormModalMessage(current.target, 'https://module.example', {
      type: 'LIVESHOP_HOST_FORM_MODAL_COMMAND', protocol: HOST_PROTOCOL, requestId: 'request-0001',
      command: 'set-fields', title: '编辑 Agora',
      fields: [
        { name: 'driver', label: '流媒体方式', kind: 'select', options: ['AGORA', 'SRS'] },
        { name: 'agoraAppId', label: 'Agora App ID', required: true },
      ],
      values: { driver: 'AGORA', agoraAppId: 'app-id', ignored: 'not-a-field' },
    })).toBe(true)

    expect(document.querySelector('.ls-ui-modal-title')?.textContent).toBe('编辑 Agora')
    expect(document.querySelector('[name="username"]')).toBeNull()
    expect((document.querySelector('[name="driver"]') as HTMLSelectElement).value).toBe('AGORA')
    expect((document.querySelector('[name="agoraAppId"]') as HTMLInputElement).value).toBe('app-id')
    expect(current.sent.some(entry => entry.message.type === 'LIVESHOP_HOST_FORM_MODAL_CLOSED')).toBe(false)

    ;(document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(current.sent.at(-1)?.message).toMatchObject({
      type: 'LIVESHOP_HOST_FORM_MODAL_SUBMIT', requestId: 'request-0001',
      values: { driver: 'AGORA', agoraAppId: 'app-id' },
    })
  })

  it('replaces concurrent iframe modals deterministically', () => {
    const first = owner()
    const second = owner()
    handleHostFormModalMessage(first.target, 'https://first.example', openMessage('request-0001'))
    handleHostFormModalMessage(second.target, 'https://second.example', openMessage('request-0002'))

    expect(document.body.querySelectorAll('.ls-ui-modal-backdrop')).toHaveLength(1)
    expect(first.sent.at(-1)?.message).toMatchObject({
      type: 'LIVESHOP_HOST_FORM_MODAL_CLOSED', requestId: 'request-0001', reason: 'replaced',
    })
  })

  it('closes and restores the Host when the owning iframe unmounts', () => {
    const current = owner()
    handleHostFormModalMessage(current.target, 'https://module.example', openMessage())
    disposeHostFormModalOwner(current.target)

    expect(document.body.querySelector('.ls-ui-modal-backdrop')).toBeNull()
    expect((document.querySelector('#app') as HTMLElement).inert).toBeFalsy()
    expect(document.documentElement.classList.contains('ls-host--modal-open')).toBe(false)
    expect(current.sent.at(-1)?.message).toMatchObject({
      type: 'LIVESHOP_HOST_FORM_MODAL_CLOSED', reason: 'owner-unmounted',
    })
  })
})
