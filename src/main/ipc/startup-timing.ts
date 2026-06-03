import { ipcMain } from 'electron'
import { isStartupTimingReport, type StartupTimingReport } from '../../shared/startup-phase-timing'
import { isStartupDiagnosticsEnabled, logStartupTimingReport } from '../startup/startup-diagnostics'

let registered = false

export function registerStartupTimingHandlers(): void {
  if (registered) {
    return
  }
  registered = true

  ipcMain.on('startup:timing-report', (_event, report: StartupTimingReport) => {
    if (!isStartupDiagnosticsEnabled() || !isStartupTimingReport(report)) {
      return
    }
    logStartupTimingReport(report)
  })
}
