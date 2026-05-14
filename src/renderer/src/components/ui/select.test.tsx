import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'

import { SelectContent } from './select'

describe('SelectContent', () => {
  it('caps long menus and keeps scrolling inside the select content', () => {
    const portal = SelectContent({ children: null })

    expect(isValidElement(portal)).toBe(true)
    const content = portal.props.children
    expect(isValidElement(content)).toBe(true)

    expect(content.props.className).toContain(
      'max-h-[min(var(--radix-select-content-available-height),20rem)]'
    )
    expect(content.props.className).toContain('overflow-y-auto')
    expect(content.props.className).toContain('scrollbar-sleek')
  })
})
