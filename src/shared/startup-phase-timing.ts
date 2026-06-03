export type StartupTimingOrigin = 'main' | 'renderer'

export type StartupTimingPhaseStatus = 'ok' | 'error'

export type StartupTimingDetails = Record<string, unknown>

export type StartupTimingPhase = {
  name: string
  status: StartupTimingPhaseStatus
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  details?: StartupTimingDetails
}

export type StartupTimingMilestone = {
  name: string
  atMs: number
  elapsedMs: number
  details?: StartupTimingDetails
}

export type StartupTimingReport = {
  origin: StartupTimingOrigin
  startedAtMs: number
  capturedAtMs: number
  elapsedMs: number
  phases: StartupTimingPhase[]
  milestones: StartupTimingMilestone[]
  details?: StartupTimingDetails
}

type StartupPhaseTimerOptions = {
  origin: StartupTimingOrigin
  now?: () => number
  details?: StartupTimingDetails
}

type PhaseOptions = {
  details?: StartupTimingDetails
}

type SnapshotOptions = {
  details?: StartupTimingDetails
}

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function roundedMs(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeDetails(details?: StartupTimingDetails): StartupTimingDetails | undefined {
  if (!details || Object.keys(details).length === 0) {
    return undefined
  }
  return details
}

function errorDetails(error: unknown): StartupTimingDetails {
  if (error instanceof Error) {
    return { error: error.message, name: error.name }
  }
  return { error: String(error) }
}

export class StartupPhaseTimer {
  private readonly origin: StartupTimingOrigin
  private readonly now: () => number
  private readonly startedAtMs: number
  private readonly details?: StartupTimingDetails
  private readonly phases: StartupTimingPhase[] = []
  private readonly milestones: StartupTimingMilestone[] = []

  constructor(options: StartupPhaseTimerOptions) {
    this.origin = options.origin
    this.now = options.now ?? defaultNow
    this.startedAtMs = this.now()
    this.details = normalizeDetails(options.details)
  }

  markMilestone(name: string, details?: StartupTimingDetails): void {
    const atMs = this.now()
    const normalizedDetails = normalizeDetails(details)
    this.milestones.push({
      name,
      atMs: roundedMs(atMs),
      elapsedMs: roundedMs(atMs - this.startedAtMs),
      ...(normalizedDetails ? { details: normalizedDetails } : {})
    })
  }

  measureSync<T>(name: string, task: () => T, options: PhaseOptions = {}): T {
    const startedAtMs = this.now()
    try {
      const result = task()
      this.recordPhase(name, startedAtMs, this.now(), 'ok', options.details)
      return result
    } catch (error) {
      this.recordPhase(name, startedAtMs, this.now(), 'error', {
        ...options.details,
        ...errorDetails(error)
      })
      throw error
    }
  }

  async measure<T>(name: string, task: () => Promise<T>, options: PhaseOptions = {}): Promise<T> {
    const startedAtMs = this.now()
    try {
      const result = await task()
      this.recordPhase(name, startedAtMs, this.now(), 'ok', options.details)
      return result
    } catch (error) {
      this.recordPhase(name, startedAtMs, this.now(), 'error', {
        ...options.details,
        ...errorDetails(error)
      })
      throw error
    }
  }

  snapshot(options: SnapshotOptions = {}): StartupTimingReport {
    const capturedAtMs = this.now()
    const details = normalizeDetails({
      ...this.details,
      ...options.details
    })
    return {
      origin: this.origin,
      startedAtMs: roundedMs(this.startedAtMs),
      capturedAtMs: roundedMs(capturedAtMs),
      elapsedMs: roundedMs(capturedAtMs - this.startedAtMs),
      phases: this.phases.map((phase) => ({ ...phase })),
      milestones: this.milestones.map((milestone) => ({ ...milestone })),
      ...(details ? { details } : {})
    }
  }

  private recordPhase(
    name: string,
    startedAtMs: number,
    endedAtMs: number,
    status: StartupTimingPhaseStatus,
    details?: StartupTimingDetails
  ): void {
    const normalizedDetails = normalizeDetails(details)
    this.phases.push({
      name,
      status,
      startedAtMs: roundedMs(startedAtMs),
      endedAtMs: roundedMs(endedAtMs),
      durationMs: roundedMs(endedAtMs - startedAtMs),
      ...(normalizedDetails ? { details: normalizedDetails } : {})
    })
  }
}

export function createStartupPhaseTimer(options: StartupPhaseTimerOptions): StartupPhaseTimer {
  return new StartupPhaseTimer(options)
}

export function isStartupTimingReport(value: unknown): value is StartupTimingReport {
  if (!value || typeof value !== 'object') {
    return false
  }
  const report = value as Partial<StartupTimingReport>
  return (
    (report.origin === 'main' || report.origin === 'renderer') &&
    typeof report.startedAtMs === 'number' &&
    typeof report.capturedAtMs === 'number' &&
    typeof report.elapsedMs === 'number' &&
    Array.isArray(report.phases) &&
    report.phases.every(isStartupTimingPhase) &&
    Array.isArray(report.milestones) &&
    report.milestones.every(isStartupTimingMilestone)
  )
}

function isStartupTimingPhase(value: unknown): value is StartupTimingPhase {
  if (!value || typeof value !== 'object') {
    return false
  }
  const phase = value as Partial<StartupTimingPhase>
  return (
    typeof phase.name === 'string' &&
    (phase.status === 'ok' || phase.status === 'error') &&
    typeof phase.startedAtMs === 'number' &&
    typeof phase.endedAtMs === 'number' &&
    typeof phase.durationMs === 'number'
  )
}

function isStartupTimingMilestone(value: unknown): value is StartupTimingMilestone {
  if (!value || typeof value !== 'object') {
    return false
  }
  const milestone = value as Partial<StartupTimingMilestone>
  return (
    typeof milestone.name === 'string' &&
    typeof milestone.atMs === 'number' &&
    typeof milestone.elapsedMs === 'number'
  )
}
