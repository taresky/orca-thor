import { createThorSecondarySlotStore } from './thor-secondary-slot-store'

export type { ThorSecondarySlotSnapshot as ThorSecondaryContextSnapshot } from './thor-secondary-slot-store'

const store = createThorSecondarySlotStore()

export const getThorSecondaryContextSnapshot = store.getSnapshot
export const subscribeThorSecondaryContext = store.subscribe
export const publishThorSecondaryContext = store.publish
export const clearThorSecondaryContext = store.clear
