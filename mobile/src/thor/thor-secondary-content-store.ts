import { createThorSecondarySlotStore } from './thor-secondary-slot-store'

export type { ThorSecondarySlotSnapshot as ThorSecondaryContentSnapshot } from './thor-secondary-slot-store'

const store = createThorSecondarySlotStore()

export const getThorSecondaryContentSnapshot = store.getSnapshot
export const subscribeThorSecondaryContent = store.subscribe
export const publishThorSecondaryContent = store.publish
export const clearThorSecondaryContent = store.clear
export const refreshThorSecondaryContent = store.refresh
