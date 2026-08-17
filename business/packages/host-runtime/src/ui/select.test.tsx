// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Select, type SelectOption } from './select'

const options: SelectOption[] = [
  { value: 'bnb-bsc', label: 'BNB', description: 'bsc', meta: 'BNB-BSC' },
  { value: 'eth-arbitrum', label: 'ETH', description: 'arbitrum', meta: 'ETH-ARBITRUM', disabled: true },
  { value: 'pol-polygon', label: 'POL', description: 'polygon', meta: 'POL-POLYGON' },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLElement.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

describe('Select', () => {
  it('renders the selected rich option and commits a pointer selection', () => {
    const onValueChange = vi.fn()
    act(() => root.render(
      <Select
        aria-label="区块链网络"
        name="network"
        options={options}
        defaultValue="bnb-bsc"
        onValueChange={onValueChange}
      />,
    ))

    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    expect(trigger.textContent).toContain('BNB · bsc')

    act(() => trigger.click())
    const listbox = document.body.querySelector('[role="listbox"]')
    expect(listbox).not.toBeNull()
    expect(listbox?.querySelector('[aria-selected="true"]')?.textContent).toContain('BNB')

    const polygonOption = listbox!.querySelectorAll<HTMLElement>('[role="option"]').item(2)
    act(() => polygonOption.click())
    expect(onValueChange).toHaveBeenCalledWith('pol-polygon', options[2])
    expect(trigger.textContent).toContain('POL · polygon')
    expect(container.querySelector<HTMLInputElement>('input[name="network"]')?.value).toBe('pol-polygon')
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })

  it('filters options from the shared search field and commits a click', () => {
    const onValueChange = vi.fn()
    act(() => root.render(
      <Select aria-label="区块链网络" options={options} defaultValue="bnb-bsc" onValueChange={onValueChange} />,
    ))
    act(() => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
    const search = document.body.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(search).not.toBeNull()
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      proto?.set?.call(search, 'pol')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const visible = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(visible).toHaveLength(1)
    expect(visible[0].textContent).toContain('POL')
    act(() => visible[0].click())
    expect(onValueChange).toHaveBeenCalledWith('pol-polygon', options[2])
  })

  it('supports keyboard selection and skips disabled options', () => {
    act(() => root.render(<Select aria-label="区块链网络" options={options} defaultValue="bnb-bsc" />))
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!

    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))

    const activeId = trigger.getAttribute('aria-activedescendant')
    expect(activeId).toBeTruthy()
    expect(document.getElementById(activeId!)?.textContent).toContain('POL')

    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(trigger.textContent).toContain('POL · polygon')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('portals the menu with the shared popover stacking token instead of Tailwind z-50', () => {
    act(() => root.render(<Select aria-label="区块链网络" options={options} defaultValue="bnb-bsc" />))
    act(() => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
    const menu = document.body.querySelector<HTMLElement>('.ls-ui-search-select__menu')
    expect(menu).not.toBeNull()
    expect(menu?.className).not.toMatch(/\bz-50\b/)
    expect(menu?.style.zIndex).toBe('var(--ls-z-popover)')
  })

  it('closes when the shared popover dismissal event fires', () => {
    act(() => root.render(<Select aria-label="区块链网络" options={options} defaultValue="bnb-bsc" />))
    act(() => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull()
    act(() => document.dispatchEvent(new Event('ls-ui-close-popovers')))
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
  })
})
