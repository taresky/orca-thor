import type { ContextualTourStepAction } from '../../../../shared/contextual-tours'
import type { RequestActiveTerminalPaneSplitDetail } from '@/constants/terminal'

export function performContextualTourStepAction(args: {
  action: ContextualTourStepAction
  activeTabId: string | null
  isLastStep: boolean
  finishTour: () => void
  advanceContextualTour: () => void
  detachContextualTourSource: () => void
  setSidebarOpen: (open: boolean) => void
  openTaskPage: () => void
  openModal: (modal: 'setup-guide') => void
  dispatchTerminalPaneSplit: (detail: RequestActiveTerminalPaneSplitDetail) => void
  schedule: (callback: () => void) => void
}): void {
  const advanceOrFinish = (): void => {
    if (args.isLastStep) {
      args.finishTour()
    } else {
      args.advanceContextualTour()
    }
  }

  switch (args.action.kind) {
    case 'next':
      advanceOrFinish()
      return
    case 'complete':
      args.finishTour()
      return
    case 'split-terminal-pane':
      if (args.activeTabId) {
        args.dispatchTerminalPaneSplit({ tabId: args.activeTabId, direction: 'vertical' })
      }
      return
    case 'show-worktrees':
      args.setSidebarOpen(true)
      advanceOrFinish()
      return
    case 'open-tasks':
      // Why: the auto tour starts from the terminal, but this CTA intentionally
      // navigates to Tasks before the final setup-guide step.
      args.detachContextualTourSource()
      args.openTaskPage()
      advanceOrFinish()
      return
    case 'open-getting-started':
      args.finishTour()
      args.schedule(() => {
        args.openModal('setup-guide')
      })
  }
}
