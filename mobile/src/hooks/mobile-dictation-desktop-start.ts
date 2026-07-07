import { isCurrentMobileDictationStart } from './mobile-dictation-session-state'
import type { MobileDictationKeepAwakeOwner } from './mobile-dictation-keep-awake'
import type { RpcClient } from '../transport/rpc-client'

type StartMobileDictationDesktopSessionOptions = {
  client: RpcClient
  dictationId: string
  generation: number
  getCurrentGeneration: () => number
  getEnabled: () => boolean
  getActiveId: () => string | null
  clearActiveId: (dictationId: string) => void
  setIdle: () => void
  keepAwakeOwner: MobileDictationKeepAwakeOwner
}

function isCurrentStart(options: StartMobileDictationDesktopSessionOptions): boolean {
  return isCurrentMobileDictationStart(
    options.getCurrentGeneration(),
    options.generation,
    options.getEnabled(),
    options.getActiveId(),
    options.dictationId
  )
}

export async function startMobileDictationDesktopSession(
  options: StartMobileDictationDesktopSessionOptions
): Promise<boolean> {
  const { client, dictationId, keepAwakeOwner, setIdle } = options

  try {
    const response = await client.sendRequest('speech.dictation.start', { dictationId })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
  } catch (err) {
    options.clearActiveId(dictationId)
    await client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
    setIdle()
    throw err
  }

  if (!isCurrentStart(options)) {
    await client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
    options.clearActiveId(dictationId)
    setIdle()
    return false
  }

  try {
    // Keep-awake is acquired only after the desktop session exists, so stale
    // mobile starts can be canceled without holding a screen-lock tag.
    await keepAwakeOwner.acquire(dictationId)
  } catch (err) {
    if (!isCurrentStart(options)) {
      return false
    }
    options.clearActiveId(dictationId)
    await client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
    setIdle()
    throw err
  }

  if (!isCurrentStart(options)) {
    await keepAwakeOwner.release(dictationId).catch(() => undefined)
    await client.sendRequest('speech.dictation.cancel', { dictationId }).catch(() => undefined)
    options.clearActiveId(dictationId)
    setIdle()
    return false
  }

  return true
}
