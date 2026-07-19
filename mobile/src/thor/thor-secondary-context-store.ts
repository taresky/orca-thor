import type { ReactNode } from 'react'

export type ThorSecondaryContextSnapshot = {
  owner: string | null
  content: ReactNode | null
}

const EMPTY_SNAPSHOT: ThorSecondaryContextSnapshot = { owner: null, content: null }

let snapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

export function getThorSecondaryContextSnapshot(): ThorSecondaryContextSnapshot {
  return snapshot
}

export function subscribeThorSecondaryContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishThorSecondaryContext(owner: string, content: ReactNode): void {
  if (snapshot.owner === owner && snapshot.content === content) {
    return
  }
  snapshot = { owner, content }
  notify()
}

export function clearThorSecondaryContext(owner: string): void {
  if (snapshot.owner !== owner) {
    return
  }
  snapshot = EMPTY_SNAPSHOT
  notify()
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}
