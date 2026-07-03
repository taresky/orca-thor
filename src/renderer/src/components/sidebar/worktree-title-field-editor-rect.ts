import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

// Why: SSR (renderToStaticMarkup) has no layout; skip useLayoutEffect there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type FieldEditorRect = { left: number; top: number; width: number }

// Why: the hovercard field editor is portaled onto the document body so its
// input escapes Radix's position:fixed, GPU-composited hover panel — Chromium
// paints a stale default cursor over inputs on a composited fixed layer during
// fast pointer motion (the reported I-beam/arrow flicker). Track the in-flow
// anchor's box so the portaled editor stays pinned over the title, following the
// hover panel through scroll and resize.
export function useFieldEditorAnchorRect(
  active: boolean,
  anchorRef: RefObject<HTMLElement | null>
): FieldEditorRect | null {
  const [rect, setRect] = useState<FieldEditorRect | null>(null)

  useIsoLayoutEffect(() => {
    if (!active || typeof window === 'undefined') {
      setRect(null)
      return
    }
    const measure = (): void => {
      const node = anchorRef.current
      if (!node) {
        return
      }
      const box = node.getBoundingClientRect()
      setRect((current) => {
        const next = {
          left: box.left + window.scrollX,
          top: box.top + window.scrollY,
          width: box.width
        }
        return current &&
          current.left === next.left &&
          current.top === next.top &&
          current.width === next.width
          ? current
          : next
      })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [active, anchorRef])

  return rect
}
