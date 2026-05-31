import type { FeatureInteractionId } from './feature-interactions'

export type ContextualTourId =
  | 'workspace-board'
  | 'workspace-agent-sessions'
  | 'browser'
  | 'tasks'
  | 'automations'
  | 'workspace-creation'

export type ContextualTourStepControl = {
  kind: 'auto-rename-branch-from-work'
}

export type ContextualTourStepActionKind =
  | 'next'
  | 'complete'
  | 'split-terminal-pane'
  | 'show-worktrees'
  | 'open-tasks'
  | 'open-getting-started'

export type ContextualTourStepAction = {
  kind: ContextualTourStepActionKind
  label: string
}

export type ContextualTourStepPlacement = 'top' | 'right' | 'bottom' | 'left'

export type ContextualTourStep = {
  title: string
  body: string
  targetSelector: string
  requiredForStart?: boolean
  fallbackCopy?: string
  preferredPlacement?: ContextualTourStepPlacement
  control?: ContextualTourStepControl
  primaryAction?: ContextualTourStepAction
  secondaryAction?: ContextualTourStepAction
  advanceOnFeatureInteraction?: FeatureInteractionId
}

export type ContextualTour = {
  id: ContextualTourId
  allowedActiveModals?: readonly string[]
  steps: readonly ContextualTourStep[]
}

export const CONTEXTUAL_TOURS = [
  {
    id: 'workspace-board',
    steps: [
      {
        title: 'Plan work on the board',
        body: 'Use the board when you want to see workspaces by status instead of by project.',
        targetSelector: '[data-contextual-tour-target="workspace-board-surface"]',
        requiredForStart: true
      },
      {
        title: 'Move work through lanes',
        body: 'Statuses make active, reviewing, and finished work easy to scan.',
        targetSelector: '[data-contextual-tour-target="workspace-board-lanes"]'
      },
      {
        title: 'Drag cards and tune density',
        body: 'Drop cards into lanes, resize columns, or switch compact mode from the board controls.',
        targetSelector: '[data-contextual-tour-target="workspace-board-cards"]'
      }
    ]
  },
  {
    id: 'workspace-agent-sessions',
    steps: [
      {
        title: 'Work side by side',
        body: 'Orca is built for running more than one thread of work at once.',
        targetSelector: '[data-contextual-tour-target="workspace-agent-terminal-tip"]',
        requiredForStart: true,
        preferredPlacement: 'bottom',
        primaryAction: { kind: 'next', label: 'Show me' }
      },
      {
        title: 'Split the terminal',
        body: 'Split right to make room for another agent, a server, or a follow-up.',
        targetSelector:
          '[data-contextual-tour-target="terminal-pane-split-target"], [data-contextual-tour-target="workspace-agent-terminal-tip"]',
        preferredPlacement: 'bottom',
        primaryAction: { kind: 'split-terminal-pane', label: 'Split terminal' },
        advanceOnFeatureInteraction: 'terminal-pane-split'
      },
      {
        title: 'Keep separate tasks isolated',
        body: 'Use separate worktrees when you want different tasks or agents isolated from each other.',
        targetSelector:
          '[data-contextual-tour-target="workspace-list"], [data-contextual-tour-target="workspace-create-control"], [data-contextual-tour-target="sidebar-workspaces"]',
        preferredPlacement: 'right',
        primaryAction: { kind: 'show-worktrees', label: 'Show worktrees' },
        secondaryAction: { kind: 'next', label: 'Skip' }
      },
      {
        title: 'Start from real work',
        body: 'Start from tasks, issues, reviews, or merge requests so agents begin with the right context.',
        targetSelector:
          '[data-contextual-tour-target="sidebar-tasks"], [data-contextual-tour-target="tasks-source-filters"], [data-contextual-tour-target="sidebar-navigation"]',
        preferredPlacement: 'right',
        primaryAction: { kind: 'open-tasks', label: 'Show tasks' },
        secondaryAction: { kind: 'next', label: 'Skip' }
      },
      {
        title: 'Orchestrate capable agents',
        body: 'Use browser context, setup scripts, notifications, orchestration, and action skills so agents can coordinate beyond the terminal.',
        targetSelector:
          '[data-contextual-tour-target="browser-toolbar"], [data-contextual-tour-target="setup-guide-entry"], [data-contextual-tour-target="sidebar-navigation"]',
        preferredPlacement: 'right',
        primaryAction: { kind: 'open-getting-started', label: 'Open Getting started' },
        secondaryAction: { kind: 'complete', label: 'Done' }
      }
    ]
  },
  {
    id: 'browser',
    steps: [
      {
        title: 'Preview the app here',
        body: 'Use the address bar for localhost, URLs, or search while you keep coding nearby.',
        targetSelector:
          '[data-contextual-tour-target="browser-address"], [data-orca-browser-address-bar="true"]',
        requiredForStart: true
      },
      {
        title: 'Grab page context for agents',
        body: 'On supported local pages, grab controls can copy elements or hand page context to an agent.',
        targetSelector: '[data-contextual-tour-target="browser-grab-control"]'
      },
      {
        title: 'Mark design feedback in place',
        body: 'On supported local pages, annotate elements and send those notes to an agent.',
        targetSelector: '[data-contextual-tour-target="browser-annotation-control"]'
      }
    ]
  },
  {
    id: 'tasks',
    steps: [
      {
        title: 'Choose the work source',
        body: 'Switch between connected providers and project filters without changing pages.',
        targetSelector: '[data-contextual-tour-target="tasks-source-filters"]',
        requiredForStart: true
      },
      {
        title: 'Filter to the work you need',
        body: 'Use presets and search to narrow issues, reviews, merge requests, or tasks.',
        targetSelector: '[data-contextual-tour-target="tasks-search-presets"]'
      },
      {
        title: 'Start from tracked work',
        body: 'Open an item or create one, then use it to start a workspace with the right context.',
        targetSelector:
          '[data-contextual-tour-target="tasks-actions"], [data-contextual-tour-target="tasks-search-presets"]'
      }
    ]
  },
  {
    id: 'automations',
    steps: [
      {
        title: 'Review recurring work',
        body: 'The list shows scheduled agent work, next runs, and external automation sources.',
        targetSelector: '[data-contextual-tour-target="automations-list"]',
        requiredForStart: true
      },
      {
        title: 'Create a schedule',
        body: 'Add an automation for recurring checks, maintenance, or follow-up agent work.',
        targetSelector: '[data-contextual-tour-target="automations-create"]'
      },
      {
        title: 'Run and inspect results',
        body: 'Use overview and runs to trigger work manually and review what happened.',
        targetSelector: '[data-contextual-tour-target="automations-runs"]'
      }
    ]
  },
  {
    id: 'workspace-creation',
    allowedActiveModals: ['new-workspace-composer'],
    steps: [
      {
        title: 'Pick a project',
        body: 'Orca isolates each task in its own worktree, branched off your base. Pick the project this one should branch from.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-project"]',
        requiredForStart: true
      },
      {
        title: 'Name it, or start from existing work',
        body: 'Start a workspace from a task source to inherit the title. Or leave it blank to auto-name it from your first agent message.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-name"]',
        control: { kind: 'auto-rename-branch-from-work' }
      },
      {
        title: 'Choose who starts the work',
        body: 'Pick the agent you want, then create the workspace. Orca opens a separate place for this task.',
        targetSelector: '[data-contextual-tour-target="workspace-creation-agent"]'
      }
    ]
  }
] as const satisfies readonly ContextualTour[]

export const CONTEXTUAL_TOUR_IDS = CONTEXTUAL_TOURS.map((tour) => tour.id)

export function isContextualTourId(value: unknown): value is ContextualTourId {
  return typeof value === 'string' && CONTEXTUAL_TOUR_IDS.includes(value as ContextualTourId)
}

export function getContextualTour(id: ContextualTourId): ContextualTour {
  return CONTEXTUAL_TOURS.find((tour) => tour.id === id)!
}

export function normalizeContextualTourIds(value: unknown): ContextualTourId[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<ContextualTourId>()
  for (const item of value) {
    if (isContextualTourId(item)) {
      seen.add(item)
    }
  }
  return [...seen]
}
