import { describe, expect, it, vi } from 'vitest'
import type { ExecutionHostRegistryEntry } from '../../../../shared/execution-host-registry'
import { PROJECT_HOST_SETUP_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { buildSetupHostOptions } from './repository-host-setup-options'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

function runtimeHost(
  overrides: Partial<ExecutionHostRegistryEntry> = {}
): ExecutionHostRegistryEntry {
  return {
    id: 'runtime:env-1',
    kind: 'runtime',
    label: 'Remote Orca',
    detail: 'Orca server',
    health: 'available',
    ...overrides
  } as ExecutionHostRegistryEntry
}

describe('buildSetupHostOptions', () => {
  it('disables runtime hosts while capabilities are unknown', () => {
    expect(
      buildSetupHostOptions({
        projectHostSetups: [],
        hostOptions: [runtimeHost()]
      })[0]
    ).toMatchObject({
      isAvailable: false,
      detail: 'Checking host capabilities'
    })
  })

  it('enables runtime hosts that advertise project-host setup support', () => {
    expect(
      buildSetupHostOptions({
        projectHostSetups: [],
        hostOptions: [
          runtimeHost({
            capabilities: [PROJECT_HOST_SETUP_RUNTIME_CAPABILITY]
          })
        ]
      })[0]
    ).toMatchObject({
      isAvailable: true,
      detail: 'Orca server'
    })
  })
})
