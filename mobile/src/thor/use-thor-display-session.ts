import { useEffect, useRef, useState } from 'react'
import {
  addThorControlListener,
  addThorStatusListener,
  clearThorDisplaySession,
  isThorDisplayModuleAvailable,
  restoreThorDisplayDraft,
  setThorDisplaySending,
  startThorDisplay,
  stopThorDisplay,
  updateThorDisplaySession
} from '@orca/expo-thor-display'
import type { ConnectionState } from '../transport/types'
import {
  sendThorDisplayControl,
  shouldRestoreThorDisplayDraft,
  type ThorTerminalSendTarget
} from './thor-display-terminal-send'

type UseThorDisplaySessionOptions = ThorTerminalSendTarget & {
  active: boolean
  connectionState: ConnectionState
  terminalTitle: string
  worktreeName: string
}

export function useThorDisplaySession(options: UseThorDisplaySessionOptions): boolean {
  const targetRef = useRef<ThorTerminalSendTarget>(options)
  const displayStateRef = useRef({
    active: options.active,
    connectionState: options.connectionState,
    terminalTitle: options.terminalTitle,
    worktreeName: options.worktreeName
  })
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingSendCountRef = useRef(0)
  const [secondaryActive, setSecondaryActive] = useState(false)
  targetRef.current = {
    client: options.client,
    clientId: options.clientId,
    connected: options.connected,
    terminal: options.active ? options.terminal : null
  }
  displayStateRef.current = {
    active: options.active,
    connectionState: options.connectionState,
    terminalTitle: options.terminalTitle,
    worktreeName: options.worktreeName
  }

  useEffect(() => {
    if (!isThorDisplayModuleAvailable()) {
      return
    }
    // Why: the native module itself verifies AYN Thor hardware; mounting this
    // hook on ordinary Android/iOS devices remains a no-op.
    let disposed = false
    // Why: production stays hardware-gated to AYN Thor, while debug builds can
    // exercise the same Presentation UI on Android's simulated second display.
    const statusSubscription = addThorStatusListener((status) => {
      if (!disposed) {
        setSecondaryActive(status.started)
      }
    })
    void startThorDisplay(__DEV__)
      .then((status) => {
        if (!disposed) {
          setSecondaryActive(status?.started === true)
          // Why: start crosses the native bridge; the first state update can
          // otherwise arrive before the controller exists and be lost.
          updateThorDisplaySession(displayStateRef.current)
        }
      })
      .catch(() => undefined)
    const subscription = addThorControlListener((event) => {
      // A queued tap belongs to the terminal visible when it happened, not the
      // terminal active after an older network send finishes.
      const target = { ...targetRef.current }
      pendingSendCountRef.current += 1
      setThorDisplaySending(true)
      // Why: preserve button order when a fast tap follows a text submit while
      // the desktop host is reached over a latent LAN/relay connection.
      sendQueueRef.current = sendQueueRef.current.then(async () => {
        let failedDraft: string | null = null
        try {
          const result = await sendThorDisplayControl(event, target)
          // Restore visibly even after a terminal switch; silently losing an IME
          // composition is worse than asking the user to review the restored text.
          if (shouldRestoreThorDisplayDraft(event, result)) {
            failedDraft = event.text
          }
        } finally {
          pendingSendCountRef.current -= 1
          if (!disposed && pendingSendCountRef.current === 0) {
            setThorDisplaySending(false)
          }
        }
        if (!disposed && failedDraft !== null) {
          restoreThorDisplayDraft(failedDraft)
        }
      })
    })
    return () => {
      disposed = true
      setSecondaryActive(false)
      statusSubscription.remove()
      subscription.remove()
      clearThorDisplaySession()
      stopThorDisplay()
    }
  }, [])

  useEffect(() => {
    if (!isThorDisplayModuleAvailable()) {
      return
    }
    updateThorDisplaySession(displayStateRef.current)
  }, [options.active, options.connectionState, options.terminalTitle, options.worktreeName])

  return secondaryActive
}
