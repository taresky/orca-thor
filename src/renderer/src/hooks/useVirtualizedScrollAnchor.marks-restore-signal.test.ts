import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgrammaticScrollMarks } from './programmatic-scroll-marks'

function createReactHookHarness() {
  const refs: { current: unknown }[] = []
  const effects: {
    deps: readonly unknown[] | undefined
    effect: () => void | (() => void)
  }[] = []
  let refIndex = 0

  return {
    beginRender: () => {
      refIndex = 0
      effects.length = 0
    },
    effects,
    react: {
      useCallback: <T extends (...args: never[]) => unknown>(callback: T): T => callback,
      useLayoutEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
        effects.push({ deps, effect })
      },
      useMemo: <T>(factory: () => T): T => factory(),
      useRef: <T>(initialValue: T): { current: T } => {
        const index = refIndex
        refIndex += 1
        refs[index] ??= { current: initialValue }
        return refs[index] as { current: T }
      }
    }
  }
}

type FakeRowElement = {
  getBoundingClientRect: () => { bottom: number; height: number; top: number }
  isConnected: boolean
  key: string
}

function createScrollElement({
  clientHeight = 880,
  rowElements = [] as FakeRowElement[],
  scrollHeight = 30_000,
  scrollTop = 0
}) {
  const scrollHandlers: ((event: Event) => void)[] = []
  const el = {
    addEventListener: vi.fn((eventName: string, handler: (event: Event) => void) => {
      if (eventName === 'scroll') {
        scrollHandlers.push(handler)
      }
    }),
    clientHeight,
    getBoundingClientRect: () => ({ bottom: clientHeight, top: 0 }),
    querySelectorAll: vi.fn(() => rowElements),
    removeEventListener: vi.fn(),
    scrollHeight,
    scrollTop
  }
  return {
    el,
    emitScroll: (top: number): void => {
      el.scrollTop = top
      const event = new Event('scroll')
      scrollHandlers.forEach((handler) => handler(event))
    }
  }
}

const anchoredRowElement = (key: string, top: number): FakeRowElement => ({
  getBoundingClientRect: () => ({ bottom: top + 4_000, height: 4_000, top }),
  isConnected: true,
  key
})

describe('useVirtualizedScrollAnchor with marks + restoreSignal', () => {
  afterEach(() => {
    vi.doUnmock('react')
    vi.resetModules()
  })

  const loadHook = async () => {
    const harness = createReactHookHarness()
    vi.doMock('react', () => harness.react)
    const { useVirtualizedScrollAnchor } = await import('./useVirtualizedScrollAnchor')
    return { harness, useVirtualizedScrollAnchor }
  }

  const virtualizerWithRow1 = () => ({
    getVirtualItems: () => [
      { index: 0, start: 0, end: 758 },
      { index: 1, start: 758, end: 4_512 }
    ],
    isScrolling: false,
    scrollToIndex: vi.fn()
  })

  it('does not re-attempt restore on measurement churn when the signal is unchanged', async () => {
    const { harness, useVirtualizedScrollAnchor } = await loadHook()
    // Row-1 already sits exactly at the anchored offset, so the first run confirms.
    const { el } = createScrollElement({
      rowElements: [anchoredRowElement('row-1', -3_358)],
      scrollTop: 746
    })
    const anchorRef = { current: { key: 'row-1', offset: 3_358, scrollTop: 746 } }
    const virtualizer = virtualizerWithRow1()

    const render = (restoreSignal: string, totalSize: number) => {
      harness.beginRender()
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- test harness mocks React's hook dispatcher directly.
      useVirtualizedScrollAnchor({
        anchorRef,
        getItemElementKey: (element: FakeRowElement) => element.key,
        getRowKey: (row: string) => row,
        itemElementSelector: '[data-row]',
        programmaticScrollMarks: createProgrammaticScrollMarks(),
        recordAnchorOnScroll: false,
        restoreSignal,
        rows: ['row-0', 'row-1'],
        scrollElementRef: { current: el },
        scrollOffsetRef: { current: 746 },
        totalSize,
        virtualizer
      } as never)
      harness.effects[1]?.effect()
    }

    render('signal-a', 30_000)
    expect(el.querySelectorAll).toHaveBeenCalled()
    const attemptsAfterConfirm = el.querySelectorAll.mock.calls.length

    // Measurement churn: totalSize changed, structural signal did not.
    render('signal-a', 31_500)
    expect(el.querySelectorAll.mock.calls.length).toBe(attemptsAfterConfirm)
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('lets the user position win when the viewport moved after the anchor was recorded', async () => {
    const { harness, useVirtualizedScrollAnchor } = await loadHook()
    const { el } = createScrollElement({
      rowElements: [anchoredRowElement('row-1', -3_358)],
      // The user (or compositor) scrolled beyond where the anchor was recorded.
      scrollTop: 906
    })
    const anchorRef = { current: { key: 'row-1', offset: 3_358, scrollTop: 746 } }
    const virtualizer = virtualizerWithRow1()

    harness.beginRender()
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- test harness mocks React's hook dispatcher directly.
    useVirtualizedScrollAnchor({
      anchorRef,
      getItemElementKey: (element: FakeRowElement) => element.key,
      getRowKey: (row: string) => row,
      itemElementSelector: '[data-row]',
      programmaticScrollMarks: createProgrammaticScrollMarks(),
      recordAnchorOnScroll: false,
      restoreSignal: 'signal-a',
      rows: ['row-0', 'row-1'],
      scrollElementRef: { current: el },
      scrollOffsetRef: { current: 746 },
      totalSize: 30_000,
      virtualizer
    } as never)
    harness.effects[1]?.effect()

    expect(el.scrollTop).toBe(906)
    expect(el.querySelectorAll).not.toHaveBeenCalled()
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('still restores when a browser clamp explains the divergence', async () => {
    const { harness, useVirtualizedScrollAnchor } = await loadHook()
    // Content above shrank: the anchor points past the new max and the browser
    // clamped the viewport to the bottom.
    const { el } = createScrollElement({
      rowElements: [],
      scrollHeight: 2_000,
      scrollTop: 1_120
    })
    const anchorRef = { current: { key: 'row-1', offset: 3_358, scrollTop: 5_000 } }
    const virtualizer = virtualizerWithRow1()

    harness.beginRender()
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- test harness mocks React's hook dispatcher directly.
    useVirtualizedScrollAnchor({
      anchorRef,
      getItemElementKey: (element: FakeRowElement) => element.key,
      getRowKey: (row: string) => row,
      itemElementSelector: '[data-row]',
      programmaticScrollMarks: createProgrammaticScrollMarks(),
      recordAnchorOnScroll: false,
      restoreSignal: 'signal-a',
      rows: ['row-0', 'row-1'],
      scrollElementRef: { current: el },
      scrollOffsetRef: { current: 5_000 },
      totalSize: 2_000,
      virtualizer
    } as never)
    harness.effects[1]?.effect()

    expect(el.querySelectorAll).toHaveBeenCalled()
  })

  it('yields the mount restore to an unmarked user scroll instead of rewriting it', async () => {
    const { harness, useVirtualizedScrollAnchor } = await loadHook()
    const { el, emitScroll } = createScrollElement({ scrollTop: 0 })
    const anchorRef = { current: null }

    harness.beginRender()
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- test harness mocks React's hook dispatcher directly.
    useVirtualizedScrollAnchor({
      anchorRef,
      getRowKey: (row: string) => row,
      programmaticScrollMarks: createProgrammaticScrollMarks(),
      recordAnchorOnScroll: false,
      restoreSignal: 'signal-a',
      rows: ['row-0', 'row-1'],
      scrollElementRef: { current: el },
      scrollOffsetRef: { current: 4_000 },
      totalSize: 30_000,
      virtualizer: virtualizerWithRow1()
    } as never)
    harness.effects[0]?.effect()
    // The mount write landed and was marked.
    expect(el.scrollTop).toBe(4_000)

    // An unmarked scroll means the user took over — even without any wheel
    // event reaching a direct-input tracker (the jank case).
    emitScroll(4_200)
    expect(el.scrollTop).toBe(4_200)
  })

  it('keeps rewriting toward the target while its own marked writes settle', async () => {
    const { harness, useVirtualizedScrollAnchor } = await loadHook()
    const marks = createProgrammaticScrollMarks()
    const { el, emitScroll } = createScrollElement({ scrollTop: 0 })
    const anchorRef = { current: null }

    harness.beginRender()
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- test harness mocks React's hook dispatcher directly.
    useVirtualizedScrollAnchor({
      anchorRef,
      getRowKey: (row: string) => row,
      programmaticScrollMarks: marks,
      recordAnchorOnScroll: false,
      restoreSignal: 'signal-a',
      rows: ['row-0', 'row-1'],
      scrollElementRef: { current: el },
      scrollOffsetRef: { current: 4_000 },
      totalSize: 30_000,
      virtualizer: virtualizerWithRow1()
    } as never)
    harness.effects[0]?.effect()

    // A marked write (e.g. a virtualizer correction) landed elsewhere while
    // restoring; the restore should push back toward its target.
    marks.mark(3_500)
    emitScroll(3_500)
    expect(el.scrollTop).toBe(4_000)
  })
})
