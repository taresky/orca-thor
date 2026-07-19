import type { ThorControlEvent } from '@orca/expo-thor-display'
import type { RpcClient } from '../transport/rpc-client'
import { isTerminalLiveInputWithinByteLimit } from '../terminal/terminal-live-input'
import { isTerminalSendRpcAccepted } from '../terminal/terminal-send-rpc-response'
import { normalizeTerminalTextInput } from '../terminal/terminal-text-input-normalization'

export type ThorTerminalSendTarget = {
  client: RpcClient | null
  clientId: string | null
  connected: boolean
  terminal: string | null
}

export type ThorTerminalSendResult = 'sent' | 'ignored' | 'failed'

export function shouldRestoreThorDisplayDraft(
  event: ThorControlEvent,
  result: ThorTerminalSendResult
): boolean {
  return event.kind === 'submit' && result !== 'sent'
}

export async function sendThorDisplayControl(
  event: ThorControlEvent,
  target: ThorTerminalSendTarget
): Promise<ThorTerminalSendResult> {
  if (!target.client || !target.connected || !target.terminal) {
    return 'ignored'
  }

  const text = normalizeTerminalTextInput(event.text)
  if (event.kind === 'raw' && text.length === 0) {
    return 'ignored'
  }
  if (!isTerminalLiveInputWithinByteLimit(text)) {
    return 'failed'
  }

  try {
    const response = await target.client.sendRequest('terminal.send', {
      terminal: target.terminal,
      text,
      enter: event.kind === 'submit',
      ...(target.clientId ? { client: { id: target.clientId, type: 'mobile' as const } } : {})
    })
    return isTerminalSendRpcAccepted(response) ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
