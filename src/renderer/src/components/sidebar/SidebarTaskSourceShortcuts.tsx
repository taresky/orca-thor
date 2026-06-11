import React from 'react'
import { Github, Gitlab } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { JiraIcon } from '@/components/icons/JiraIcon'
import { translate } from '@/i18n/i18n'
import type { TaskProvider } from '../../../../shared/task-providers'

function TaskProviderShortcut({
  canBrowseTasks,
  label,
  onOpen,
  children
}: {
  canBrowseTasks: boolean
  label: string
  onOpen: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      role={canBrowseTasks ? 'button' : undefined}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation()
        if (!canBrowseTasks) {
          return
        }
        onOpen()
      }}
      className={cn(
        'rounded p-0.5 text-muted-foreground/70',
        canBrowseTasks ? 'transition-colors hover:text-foreground' : 'cursor-default'
      )}
      aria-label={canBrowseTasks ? label : undefined}
      aria-hidden={canBrowseTasks ? undefined : true}
    >
      {children}
    </span>
  )
}

export function SidebarTaskSourceShortcuts({
  canBrowseTasks,
  visibleTaskProviders,
  onOpenTaskSource
}: {
  canBrowseTasks: boolean
  visibleTaskProviders: readonly TaskProvider[]
  onOpenTaskSource: (taskSource: TaskProvider) => void
}): React.JSX.Element {
  return (
    <span className="hidden items-center gap-1 group-hover:flex group-focus-within:flex">
      {visibleTaskProviders.includes('github') ? (
        <TaskProviderShortcut
          canBrowseTasks={canBrowseTasks}
          label={translate('auto.components.sidebar.SidebarNav.0ccba862b8', 'Open GitHub tasks')}
          onOpen={() => {
            onOpenTaskSource('github')
          }}
        >
          <Github className="size-3.5" aria-hidden />
        </TaskProviderShortcut>
      ) : null}
      {visibleTaskProviders.includes('gitlab') ? (
        <TaskProviderShortcut
          canBrowseTasks={canBrowseTasks}
          label={translate('auto.components.sidebar.SidebarNav.196c1b5362', 'Open GitLab tasks')}
          onOpen={() => {
            onOpenTaskSource('gitlab')
          }}
        >
          <Gitlab className="size-3.5" aria-hidden />
        </TaskProviderShortcut>
      ) : null}
      {visibleTaskProviders.includes('linear') ? (
        <TaskProviderShortcut
          canBrowseTasks={canBrowseTasks}
          label={translate('auto.components.sidebar.SidebarNav.c39ab10000', 'Open Linear tasks')}
          onOpen={() => {
            onOpenTaskSource('linear')
          }}
        >
          <LinearIcon className="size-3.5" />
        </TaskProviderShortcut>
      ) : null}
      {visibleTaskProviders.includes('jira') ? (
        <TaskProviderShortcut
          canBrowseTasks={canBrowseTasks}
          label={translate('auto.components.sidebar.SidebarNav.e7ad3c540d', 'Open Jira tasks')}
          onOpen={() => {
            onOpenTaskSource('jira')
          }}
        >
          <JiraIcon className="size-3.5" />
        </TaskProviderShortcut>
      ) : null}
    </span>
  )
}
