import { useLayoutEffect, type ReactNode } from 'react'
import {
  clearThorSecondaryContext,
  publishThorSecondaryContext
} from './thor-secondary-context-store'

export type ThorSecondaryControlsTarget = {
  enabled: boolean
  owner: string
}

export function useThorSecondaryContext(
  target: ThorSecondaryControlsTarget | undefined,
  content: ReactNode
): void {
  const enabled = target?.enabled === true
  const owner = target?.owner ?? ''

  useLayoutEffect(() => {
    if (!enabled) {
      if (owner) {
        clearThorSecondaryContext(owner)
      }
      return undefined
    }
    publishThorSecondaryContext(owner, content)
    return () => clearThorSecondaryContext(owner)
  }, [content, enabled, owner])
}
