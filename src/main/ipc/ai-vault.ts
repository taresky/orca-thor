import { app, ipcMain } from 'electron'
import {
  configureAiVaultSessionSources,
  listAiVaultSessions,
  type AiVaultSessionSources
} from '../ai-vault/cached-session-list'
import type { AiVaultListArgs } from '../../shared/ai-vault-types'

type AiVaultHandlerOptions = AiVaultSessionSources

export function registerAiVaultHandlers(options: AiVaultHandlerOptions = {}): void {
  // Why: configure the SAME shared cache module the runtime RPC method uses so
  // there is exactly one cache instance and neither caller drops codex-home or
  // WSL injection. The runtime also configures these sources from its deps
  // (serve-mode reachable); this desktop path supplies the same source.
  configureAiVaultSessionSources(options)
  ipcMain.handle('aiVault:listSessions', (_event, args?: AiVaultListArgs) =>
    listAiVaultSessions(args)
  )
  // DOM focus/visibility events don't fire in the renderer on macOS app
  // activation, so refresh-on-refocus needs this main-process signal.
  app.on('browser-window-focus', (_event, window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('aiVault:windowFocused')
    }
  })
}
