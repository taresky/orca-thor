import type { ReactNode } from 'react'

export type ThorSecondaryContentSnapshot = {
  owner: string | null
  content: ReactNode | null
}

const EMPTY_SNAPSHOT: ThorSecondaryContentSnapshot = { owner: null, content: null }

let snapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

export function getThorSecondaryContentSnapshot(): ThorSecondaryContentSnapshot {
  return snapshot
}

export function subscribeThorSecondaryContent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishThorSecondaryContent(owner: string, content: ReactNode): void {
  if (snapshot.owner === owner && snapshot.content === content) {
    return
  }
  snapshot = { owner, content }
  notify()
}

export function clearThorSecondaryContent(owner: string): void {
  // Why: a stale session cleanup must not blank a newer session that already
  // owns the secondary display after an Expo Router transition.
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
