import React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { getVisibleAutomationSetupDecision } from './automation-setup-decision'
import type { AutomationCreateTarget, AutomationDraft } from './AutomationEditorDialog'
import type { OrcaHooks, ProjectHostSetup, Repo } from '../../../../shared/types'

type AutomationSetupDecisionFieldProps = {
  createTarget: AutomationCreateTarget
  draft: AutomationDraft
  repos: readonly Repo[]
  projectHostSetups: readonly ProjectHostSetup[]
  yamlHooks?: OrcaHooks | null
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
  onSetupDecisionTouched: () => void
}

export function AutomationSetupDecisionField({
  createTarget,
  draft,
  repos,
  projectHostSetups,
  yamlHooks,
  onDraftChange,
  onSetupDecisionTouched
}: AutomationSetupDecisionFieldProps): React.JSX.Element | null {
  const defaultDecision = getVisibleAutomationSetupDecision({
    createTarget,
    workspaceMode: draft.workspaceMode,
    repoId: draft.projectId,
    repos,
    projectHostSetups,
    yamlHooks
  })
  if (!defaultDecision) {
    return null
  }
  const checked = (draft.setupDecision ?? defaultDecision) === 'run'
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <Checkbox
        id="automation-setup-decision"
        checked={checked}
        onCheckedChange={(nextChecked) => {
          onSetupDecisionTouched()
          onDraftChange((current) => ({
            ...current,
            setupDecision: nextChecked === true ? 'run' : 'skip'
          }))
        }}
      />
      <Label
        htmlFor="automation-setup-decision"
        className="min-w-0 text-sm font-normal leading-snug text-foreground"
      >
        {translate(
          'auto.components.automations.AutomationSetupDecisionField.5a7863909c',
          'Run setup for each new workspace'
        )}
      </Label>
    </div>
  )
}
