import { describe, expect, it } from 'vitest'

import { repairTranslatedValue } from './locale-translation-policy.mjs'

describe('locale-translation-policy es round 5', () => {
  it('keeps protected workflow terms in English', () => {
    expect(
      repairTranslatedValue({
        key: 'auto.components.LinearIssueMarkdownDescriptionEditor.d9c47069ef',
        enValue: 'Markdown',
        localeValue: 'Reducción',
        locale: 'es'
      })
    ).toBe('Markdown')
    expect(
      repairTranslatedValue({
        key: 'auto.components.TaskPage.7f3f7b4c18',
        enValue: 'Description (optional, markdown)',
        localeValue: 'Descripción (opcional, rebaja)',
        locale: 'es'
      })
    ).toBe('Descripción (opcional, markdown)')
    expect(
      repairTranslatedValue({
        key: 'auto.components.right.sidebar.source.control.primary.action.ed93b4f14f',
        enValue: 'Commit',
        localeValue: 'Comprometerse',
        locale: 'es'
      })
    ).toBe('Commit')
    expect(
      repairTranslatedValue({
        key: 'auto.components.right.sidebar.GitHistoryPanel.cf7cad58d2',
        enValue: 'No commits yet',
        localeValue: 'Aún no hay compromisos',
        locale: 'es'
      })
    ).toBe('Aún no hay commits')
    expect(
      repairTranslatedValue({
        key: 'auto.components.right.sidebar.SourceControl.b94112eb9e',
        enValue: 'Commit message',
        localeValue: 'mensaje de confirmación',
        locale: 'es'
      })
    ).toBe('mensaje de Commit')
  })
})
