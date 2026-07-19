import { createContext, useContext, type ReactNode } from 'react'
import { Modal } from 'react-native'

type BottomDrawerHostMode = 'none' | 'native' | 'inline'

const BottomDrawerModalHostContext = createContext<BottomDrawerHostMode>('none')

/** True when a BottomDrawer is rendered inside a shared BottomDrawerModalHost and
 *  must therefore skip its own native Modal (the host owns the single Modal). */
export function useInsideBottomDrawerModalHost(): boolean {
  return useContext(BottomDrawerModalHostContext) !== 'none'
}

export function useBottomDrawerModalHostMode(): BottomDrawerHostMode {
  return useContext(BottomDrawerModalHostContext)
}

/**
 * Keeps drawers inside their current React surface instead of creating a native Modal window.
 * A native Modal is attached to the owning Activity, so a drawer opened from Thor's secondary
 * Presentation would otherwise jump to the upper display.
 */
export function BottomDrawerInlineHost({ children }: { children: ReactNode }) {
  return (
    <BottomDrawerModalHostContext.Provider value="inline">
      {children}
    </BottomDrawerModalHostContext.Provider>
  )
}

type Props = {
  visible: boolean
  onRequestClose: () => void
  children: ReactNode
}

// Why: iOS cannot reliably dismiss one native modal and present another in the same
// beat. Flows that swap between sibling drawer modals (e.g. the Create Workspace form
// → its repository/agent pickers) dropped the incoming modal, leaving the sheet dead
// to taps. Hosting every drawer in ONE persistent native Modal makes those swaps
// in-window view changes instead, so no present/dismiss race can eat the transition.
export function BottomDrawerModalHost({ visible, onRequestClose, children }: Props) {
  if (!visible) {
    return null
  }
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      <BottomDrawerModalHostContext.Provider value="native">
        {children}
      </BottomDrawerModalHostContext.Provider>
    </Modal>
  )
}
