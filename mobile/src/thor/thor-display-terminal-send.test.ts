import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  sendThorDisplayControl,
  shouldRestoreThorDisplayDraft,
  type ThorTerminalSendTarget
} from './thor-display-terminal-send'

function createTarget(overrides: Partial<ThorTerminalSendTarget> = {}) {
  const sendRequest = vi.fn().mockResolvedValue({
    ok: true,
    result: { send: { handle: 'terminal-1', accepted: true, bytesWritten: 1 } }
  })
  return {
    sendRequest,
    target: {
      client: { sendRequest } as unknown as RpcClient,
      clientId: 'thor-device',
      connected: true,
      terminal: 'terminal-1',
      ...overrides
    }
  }
}

describe('sendThorDisplayControl', () => {
  it('sends composed text as one entered terminal message', async () => {
    const { sendRequest, target } = createTarget()

    await expect(
      sendThorDisplayControl({ kind: 'submit', text: '请检查这个失败\r\n' }, target)
    ).resolves.toBe('sent')

    expect(sendRequest).toHaveBeenCalledWith('terminal.send', {
      terminal: 'terminal-1',
      text: '请检查这个失败\r\n',
      enter: true,
      client: { id: 'thor-device', type: 'mobile' }
    })
  })

  it('sends accessory control bytes without appending enter', async () => {
    const { sendRequest, target } = createTarget()

    await expect(sendThorDisplayControl({ kind: 'raw', text: '\u0003' }, target)).resolves.toBe(
      'sent'
    )

    expect(sendRequest).toHaveBeenCalledWith('terminal.send', {
      terminal: 'terminal-1',
      text: '\u0003',
      enter: false,
      client: { id: 'thor-device', type: 'mobile' }
    })
  })

  it('allows an empty submit to act as Enter', async () => {
    const { sendRequest, target } = createTarget({ clientId: null })

    await expect(sendThorDisplayControl({ kind: 'submit', text: '' }, target)).resolves.toBe('sent')

    expect(sendRequest).toHaveBeenCalledWith('terminal.send', {
      terminal: 'terminal-1',
      text: '',
      enter: true
    })
  })

  it('ignores input after the active terminal is cleared', async () => {
    const { sendRequest, target } = createTarget({ terminal: null })

    await expect(
      sendThorDisplayControl({ kind: 'submit', text: 'continue' }, target)
    ).resolves.toBe('ignored')

    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('reports a rejected desktop RPC', async () => {
    const { sendRequest, target } = createTarget()
    sendRequest.mockResolvedValue({ ok: false, error: { code: 'offline', message: 'offline' } })

    await expect(sendThorDisplayControl({ kind: 'raw', text: '\t' }, target)).resolves.toBe(
      'failed'
    )
  })

  it('reports a terminal send that the desktop did not accept', async () => {
    const { sendRequest, target } = createTarget()
    sendRequest.mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal-1', accepted: false, bytesWritten: 0 } }
    })

    await expect(
      sendThorDisplayControl({ kind: 'submit', text: '不要丢失' }, target)
    ).resolves.toBe('failed')
  })
})

describe('shouldRestoreThorDisplayDraft', () => {
  const submit = { kind: 'submit' as const, text: '继续' }

  it('restores submitted text whenever the host did not accept it', () => {
    expect(shouldRestoreThorDisplayDraft(submit, 'failed')).toBe(true)
    expect(shouldRestoreThorDisplayDraft(submit, 'ignored')).toBe(true)
    expect(shouldRestoreThorDisplayDraft(submit, 'sent')).toBe(false)
  })

  it('does not turn raw control keys into editable draft text', () => {
    expect(shouldRestoreThorDisplayDraft({ kind: 'raw', text: '\u0003' }, 'failed')).toBe(false)
  })
})
