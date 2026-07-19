import type { ReactNode } from 'react'

export type ThorSecondarySlotSnapshot = {
  owner: string | null
  content: ReactNode | null
}

export function createThorSecondarySlotStore() {
  const emptySnapshot: ThorSecondarySlotSnapshot = { owner: null, content: null }
  let snapshot = emptySnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot: (): ThorSecondarySlotSnapshot => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (owner: string, content: ReactNode): void => {
      if (snapshot.owner === owner && snapshot.content === content) {
        return
      }
      snapshot = { owner, content }
      for (const listener of listeners) {
        listener()
      }
    },
    clear: (owner: string): void => {
      if (snapshot.owner !== owner) {
        return
      }
      snapshot = emptySnapshot
      for (const listener of listeners) {
        listener()
      }
    },
    refresh: (): void => {
      snapshot = { ...snapshot }
      for (const listener of listeners) {
        listener()
      }
    }
  }
}
