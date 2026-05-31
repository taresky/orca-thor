export type FeatureWallSetupStepId =
  | 'default-agent'
  | 'add-two-repos'
  | 'notifications'
  | 'two-agents'
  | 'three-workspaces'
  | 'task-sources'
  | 'agent-capabilities'
  | 'setup-script'

export type FeatureWallSetupStep = {
  readonly id: FeatureWallSetupStepId
  readonly name: string
  readonly subtitle: string
  readonly description: string
}

export const FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS = [
  'two-agents',
  'three-workspaces'
] as const satisfies readonly FeatureWallSetupStepId[]

export type FeatureWallSetupSectionId = 'parallel-work' | 'setup'

export const FEATURE_WALL_SETUP_STEPS: readonly FeatureWallSetupStep[] = [
  {
    id: 'two-agents',
    name: 'Start 2 agents in one worktree',
    subtitle: 'Start 2 agents in one worktree',
    description: 'Watch two agents work in the same codebase side by side.'
  },
  {
    id: 'three-workspaces',
    name: 'Create 2 worktrees',
    subtitle: 'Create 2 worktrees',
    description: 'Keep separate tasks in separate worktrees so agents can work independently.'
  },
  {
    id: 'notifications',
    name: 'Configure notifications',
    subtitle: 'Configure notifications',
    description: 'Know when agents need attention, finish work, or get blocked.'
  },
  {
    id: 'default-agent',
    name: 'Pick a default agent',
    subtitle: 'Pick a default agent',
    description: 'Start new work with the agent you trust most, without choosing every time.'
  },
  {
    id: 'task-sources',
    name: 'Enable task sources',
    subtitle: 'Enable task sources',
    description: 'Start work directly from your tasks and keep PR status in view.'
  },
  {
    id: 'setup-script',
    name: 'Configure a setup script',
    subtitle: 'Configure a setup script',
    description:
      "Add a script that runs automatically when you create a new worktree, so you don't have to run the same command every time."
  },
  {
    id: 'add-two-repos',
    name: 'Add 2 projects',
    subtitle: 'Add 2 projects',
    description: 'Bring your key repos into Orca and run agent work across them in parallel.'
  },
  {
    id: 'agent-capabilities',
    name: 'Install CLI & Skills',
    subtitle: 'Install CLI & Skills',
    description: 'Unlock browser, orchestration, and computer-use actions for agents.'
  }
] as const

export const FEATURE_WALL_SETUP_STEP_IDS = FEATURE_WALL_SETUP_STEPS.map((step) => step.id)

export function getFeatureWallSetupSteps(): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS
}

export function getFeatureWallSetupSectionId(
  stepId: FeatureWallSetupStepId
): FeatureWallSetupSectionId {
  return FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS.includes(
    stepId as (typeof FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS)[number]
  )
    ? 'parallel-work'
    : 'setup'
}

export function getFeatureWallSetupStepsForSection(
  sectionId: FeatureWallSetupSectionId
): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS.filter(
    (step) => getFeatureWallSetupSectionId(step.id) === sectionId
  )
}

export function getFirstIncompleteFeatureWallSetupStepId(
  stepDone: Partial<Record<FeatureWallSetupStepId, boolean>>
): FeatureWallSetupStepId {
  const parallelStep = getFeatureWallSetupStepsForSection('parallel-work').find(
    (step) => !stepDone[step.id]
  )
  if (parallelStep) {
    return parallelStep.id
  }
  const setupStep = getFeatureWallSetupStepsForSection('setup').find((step) => !stepDone[step.id])
  return setupStep?.id ?? FEATURE_WALL_SETUP_STEPS[0].id
}
