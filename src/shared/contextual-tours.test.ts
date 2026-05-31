import { describe, expect, it } from 'vitest'
import {
  CONTEXTUAL_TOURS,
  normalizeContextualTourIds,
  type ContextualTour,
  type ContextualTourId
} from './contextual-tours'

describe('contextual tour definitions', () => {
  it('defines the required tours with concise visible steps', () => {
    const expectedIds: ContextualTourId[] = [
      'workspace-board',
      'workspace-agent-sessions',
      'browser',
      'tasks',
      'automations',
      'workspace-creation'
    ]

    expect(CONTEXTUAL_TOURS.map((tour) => tour.id)).toEqual(expectedIds)
    for (const tour of CONTEXTUAL_TOURS) {
      expect(tour.steps[0]?.requiredForStart).toBe(true)
      const stepCount = (tour.steps as readonly unknown[]).length
      if (stepCount === 1) {
        expect(
          (tour.steps[0] as ContextualTour['steps'][number]).advanceOnFeatureInteraction
        ).toBeTruthy()
      } else {
        expect(stepCount).toBeGreaterThanOrEqual(2)
      }
      expect(stepCount).toBeLessThanOrEqual(tour.id === 'workspace-agent-sessions' ? 5 : 3)
      for (const step of tour.steps) {
        expect(step.title.length).toBeGreaterThan(0)
        expect(step.body.length).toBeGreaterThan(0)
        expect(step.body.length).toBeLessThanOrEqual(140)
        expect(step.targetSelector).toContain('data-contextual-tour-target')
      }
    }
  })

  it('defines the workspace agent sessions value tour with split and navigation actions', () => {
    const tour = CONTEXTUAL_TOURS.find((entry) => entry.id === 'workspace-agent-sessions') as
      | ContextualTour
      | undefined

    expect(tour?.steps.map((step) => step.title)).toEqual([
      'Work side by side',
      'Split the terminal',
      'Keep separate tasks isolated',
      'Start from real work',
      'Orchestrate capable agents'
    ])
    expect(tour?.steps[0]).toMatchObject({
      requiredForStart: true,
      primaryAction: { kind: 'next', label: 'Show me' }
    })
    expect(tour?.steps[1]).toMatchObject({
      primaryAction: { kind: 'split-terminal-pane', label: 'Split terminal' },
      advanceOnFeatureInteraction: 'terminal-pane-split'
    })
    expect(tour?.steps[1]?.targetSelector).toContain('terminal-pane-split-target')
    expect(tour?.steps[1]?.targetSelector).not.toContain('terminal-split-control')
    expect(tour?.steps[1]?.secondaryAction).toBeUndefined()
    expect(tour?.steps[2]).toMatchObject({
      primaryAction: { kind: 'show-worktrees', label: 'Show worktrees' },
      secondaryAction: { kind: 'next', label: 'Skip' }
    })
    expect(tour?.steps[2]?.targetSelector).toContain('workspace-list')
    expect(tour?.steps[3]).toMatchObject({
      primaryAction: { kind: 'open-tasks', label: 'Show tasks' },
      secondaryAction: { kind: 'next', label: 'Skip' }
    })
    expect(tour?.steps[3]?.targetSelector).toContain('sidebar-tasks')
    expect(tour?.steps[4]).toMatchObject({
      primaryAction: { kind: 'open-getting-started', label: 'Open Getting started' },
      secondaryAction: { kind: 'complete', label: 'Done' }
    })
  })

  it('allows only workspace creation over its workspace composer modal', () => {
    const modalTours = (CONTEXTUAL_TOURS as readonly ContextualTour[]).filter(
      (tour) => tour.allowedActiveModals?.length
    )

    expect(modalTours.map((tour) => tour.id)).toEqual(['workspace-creation'])
    expect(modalTours[0]?.allowedActiveModals).toEqual(['new-workspace-composer'])
  })

  it('normalizes persisted ids by removing unknowns and duplicates', () => {
    expect(
      normalizeContextualTourIds([
        'tasks',
        'unknown',
        'workspace-agent-sessions',
        'browser',
        'tasks',
        null,
        'workspace-creation'
      ])
    ).toEqual(['tasks', 'workspace-agent-sessions', 'browser', 'workspace-creation'])
  })
})
