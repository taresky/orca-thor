import { useLayoutEffect, type ReactNode } from 'react'
import {
  clearThorSecondaryContent,
  publishThorSecondaryContent
} from './thor-secondary-content-store'

export function useThorSecondaryContent(owner: string, enabled: boolean, content: ReactNode): void {
  useLayoutEffect(() => {
    if (!enabled) {
      clearThorSecondaryContent(owner)
      return undefined
    }
    publishThorSecondaryContent(owner, content)
    return () => clearThorSecondaryContent(owner)
  }, [content, enabled, owner])
}
