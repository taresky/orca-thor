import React from 'react'
import { Globe } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

function getBrowserTabCountLabel(tabCount: number): string {
  if (tabCount === 1) {
    return translate(
      'auto.components.sidebar.WorktreeBrowserTabIndicator.single',
      '1 open browser tab'
    )
  }
  return translate(
    'auto.components.sidebar.WorktreeBrowserTabIndicator.multiple',
    '{{value0}} open browser tabs',
    { value0: tabCount }
  )
}

export const WorktreeBrowserTabIndicator = React.memo(function WorktreeBrowserTabIndicator({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  // Why: selecting only the count avoids rerendering every sidebar card when a
  // browser title, URL, or loading state changes inside its owning workspace.
  const tabCount = useAppStore((state) => state.browserTabsByWorktree?.[worktreeId]?.length ?? 0)
  if (tabCount === 0) {
    return null
  }

  const label = getBrowserTabCountLabel(tabCount)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-worktree-browser-tab-count={tabCount}
          className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded px-0.5 text-[11px] tabular-nums leading-none text-muted-foreground"
        >
          <Globe className="size-3" aria-hidden="true" />
          <span aria-hidden="true">{tabCount}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
})
