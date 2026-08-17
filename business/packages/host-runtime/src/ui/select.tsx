import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'

export interface SelectOption {
  value: string
  label: ReactNode
  description?: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export interface SelectProps extends Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string, option: SelectOption) => void
  placeholder?: ReactNode
  disabled?: boolean
  name?: string
}

interface MenuPosition {
  left: number
  top: number
  width: number
  maxHeight: number
}

const MENU_GAP = 8
const MENU_MAX_HEIGHT = 420

function stringifySelectContent(value: ReactNode): string {
  if (value == null || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

function enabledIndex(options: SelectOption[], start: number, direction: 1 | -1): number {
  if (!options.length) return -1
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (start + direction * offset + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return -1
}

function edgeEnabledIndex(options: SelectOption[], edge: 'first' | 'last'): number {
  const start = edge === 'first' ? 0 : options.length - 1
  const step = edge === 'first' ? 1 : -1
  for (let index = start; index >= 0 && index < options.length; index += step) {
    if (!options[index].disabled) return index
  }
  return -1
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = '请选择',
  disabled = false,
  name,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const triggerId = id ?? `ls-select-${generatedId}`
  const listboxId = `${triggerId}-listbox`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const [internalValue, setInternalValue] = useState(defaultValue ?? '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>()
  const searchRef = useRef<HTMLInputElement>(null)
  const currentValue = value ?? internalValue
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === currentValue),
    [currentValue, options],
  )
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => {
      const haystack = [option.value, stringifySelectContent(option.label), stringifySelectContent(option.description), stringifySelectContent(option.meta)]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [options, query])

  function updateMenuPosition() {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const roomBelow = window.innerHeight - rect.bottom - MENU_GAP
    const roomAbove = rect.top - MENU_GAP
    const openAbove = roomBelow < Math.min(MENU_MAX_HEIGHT, 240) && roomAbove > roomBelow
    const availableHeight = Math.max(0, Math.min(MENU_MAX_HEIGHT, openAbove ? roomAbove : roomBelow))

    setMenuPosition({
      left: rect.left,
      top: openAbove
        ? Math.max(MENU_GAP, rect.top - availableHeight - MENU_GAP)
        : rect.bottom + MENU_GAP,
      width: rect.width,
      maxHeight: availableHeight,
    })
  }

  function openMenu(preferredIndex = selectedIndex) {
    if (disabled || !options.some((option) => !option.disabled)) return
    setQuery('')
    const nextIndex = preferredIndex >= 0 && !options[preferredIndex]?.disabled
      ? preferredIndex
      : edgeEnabledIndex(options, 'first')
    setActiveIndex(nextIndex)
    setOpen(true)
  }

  function chooseVisible(index: number) {
    const option = visibleOptions[index]
    if (!option || option.disabled) return
    if (value === undefined) setInternalValue(option.value)
    onValueChange?.(option.value, option)
    setQuery('')
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const edge = event.key === 'ArrowDown' ? 'first' : 'last'
        openMenu(selectedIndex >= 0 ? selectedIndex : edgeEnabledIndex(options, edge))
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => enabledIndex(visibleOptions, current, event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(edgeEnabledIndex(visibleOptions, event.key === 'Home' ? 'first' : 'last'))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      chooseVisible(activeIndex)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      setOpen(false)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setQuery('')
        setOpen(false)
      }
    }
    const handleViewportChange = () => updateMenuPosition()

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  useEffect(() => {
    const close = () => {
      setQuery('')
      setOpen(false)
    }
    document.addEventListener('ls-ui-close-popovers', close)
    return () => document.removeEventListener('ls-ui-close-popovers', close)
  }, [])

  const menuStyle: CSSProperties | undefined = menuPosition && {
    left: menuPosition.left,
    top: menuPosition.top,
    width: menuPosition.width,
    maxHeight: menuPosition.maxHeight,
    zIndex: 'var(--ls-z-popover)',
  }

  return (
    <div className={cn('w-full min-w-0', className)} {...props}>
      {name && <input type="hidden" name={name} value={currentValue} disabled={disabled} />}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-[58px] w-full items-center gap-3 rounded-xl border bg-surface px-4 text-left shadow-card transition-colors',
          'border-primary hover:border-primary-hover focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:opacity-60',
        )}
      >
        {selectedOption?.icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full" aria-hidden="true">
            {selectedOption.icon}
          </span>
        )}
        <span className={cn('min-w-0 flex-1 truncate text-base', selectedOption ? 'text-ink' : 'text-ink-muted')}>
          {selectedOption ? (
            <>
              <span className="font-medium">{selectedOption.label}</span>
              {selectedOption.description && <span className="text-ink-muted"> · {selectedOption.description}</span>}
              {selectedOption.meta && <span className="text-ink-muted"> &nbsp;({selectedOption.meta})</span>}
            </>
          ) : placeholder}
        </span>
        {open
          ? <ChevronUp className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          : <ChevronDown className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />}
      </button>

      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="ls-ui-select-menu ls-ui-search-select__menu fixed overflow-hidden rounded-xl border border-line bg-popover p-2 shadow-pop"
        >
          <input
            ref={searchRef}
            type="search"
            className="ls-ui-search-select__search"
            placeholder="搜索"
            value={query}
            aria-label="搜索选项"
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => enabledIndex(visibleOptions, current, event.key === 'ArrowDown' ? 1 : -1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                chooseVisible(activeIndex)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setQuery('')
                setOpen(false)
                triggerRef.current?.focus()
              }
            }}
          />
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={ariaLabelledBy ?? triggerId}
            className="ls-ui-search-select__list"
          >
            {visibleOptions.length === 0 && (
              <div className="ls-ui-search-select__empty">无匹配项</div>
            )}
            {visibleOptions.map((option, index) => {
              const selected = option.value === currentValue
              const active = index === activeIndex
              return (
                <div
                  ref={(node) => { optionRefs.current[index] = node }}
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  onPointerMove={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => chooseVisible(index)}
                  className={cn(
                    'ls-ui-search-select__option flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    selected ? 'bg-primary-soft' : active ? 'bg-surface-hover' : 'bg-transparent',
                    option.disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                  )}
                >
                  {option.icon && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full" aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink">
                    <span className="font-medium">{option.label}</span>
                    {option.description && <span className="text-ink-muted"> · {option.description}</span>}
                    {option.meta && <span className="text-ink-muted"> &nbsp;({option.meta})</span>}
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
