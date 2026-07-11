import type { IDisposable } from '@xterm/xterm'

export type TerminalImeCompositionTracker = IDisposable & {
  isActive: () => boolean
  /** True while candidate-selection keys (Space/digits) should be treated as
   *  IME-owned: during a live composition, and briefly after compositionend to
   *  absorb the committing key's trailing press/release. */
  isCandidateKeyGuardActive: () => boolean
  /** Called by the key handler when a candidate-selection key (Space/digit) is
   *  suppressed while a composition is still live. The committing selector has
   *  then already been consumed, so the post-compositionend window must not arm
   *  and swallow the user's next genuine Space/digit typed within 250ms. */
  noteCandidateSelectionDuringComposition: () => void
}

// Why: suppressed candidate keys are preventDefault-ed and fire no input
// event, so a stale tracker (missed compositionend) has no natural unstick
// path. Expire the guard so Space/digits cannot stay dead indefinitely.
export const TERMINAL_IME_CANDIDATE_GUARD_STALE_COMPOSITION_EXPIRY_MS = 10_000
// Why: Sogou/fcitx can deliver the committing Space/digit as plain keydown and
// keyup after compositionend; a narrow window absorbs those trailing events
// without making the keys globally unavailable after IME use.
export const TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS = 250

export function installTerminalImeCompositionTracker(
  terminalElement: HTMLElement | null | undefined,
  options?: { now?: () => number }
): TerminalImeCompositionTracker {
  const now = options?.now ?? ((): number => Date.now())
  let active = false
  let lastCompositionEventAt: number | null = null
  let compositionEndedAt: number | null = null
  let sawEmptyCompositionUpdate = false
  // Why: when the committing Space/digit is consumed during the live
  // composition, no trailing selector arrives after compositionend, so arming
  // the post-composition window would only swallow the user's next real key.
  let candidateSelectionDuringComposition = false

  const noteCandidateSelectionDuringComposition = (): void => {
    candidateSelectionDuringComposition = true
  }

  const isActiveAt = (at: number): boolean =>
    active &&
    (lastCompositionEventAt === null ||
      at - lastCompositionEventAt <= TERMINAL_IME_CANDIDATE_GUARD_STALE_COMPOSITION_EXPIRY_MS)

  const isCandidateKeyGuardActive = (): boolean => {
    const at = now()
    if (isActiveAt(at)) {
      return true
    }
    return (
      compositionEndedAt !== null &&
      at - compositionEndedAt <= TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS
    )
  }

  if (!terminalElement) {
    return {
      isActive: () => active,
      isCandidateKeyGuardActive,
      noteCandidateSelectionDuringComposition,
      dispose: () => undefined
    }
  }

  const markActive = (): void => {
    active = true
    lastCompositionEventAt = now()
    compositionEndedAt = null
    sawEmptyCompositionUpdate = false
    candidateSelectionDuringComposition = false
  }
  const updateComposition = (event: Event): void => {
    lastCompositionEventAt = now()
    // Why: Sogou/fcitx can emit empty compositionupdate data while its
    // candidate popup is still open — empty data must not deactivate.
    // compositionend, non-composition input, and blur own deactivation.
    if (!(event instanceof CompositionEvent)) {
      return
    }
    if (event.data === '') {
      sawEmptyCompositionUpdate = true
      return
    }
    active = true
  }
  const handleCompositionEnd = (): void => {
    active = false
    // Why: only Sogou/fcitx-style empty updates prove a trailing plain
    // Space/digit is likely IME-owned; broad post-end guards drop real typing.
    // If the committing selector was already consumed during the composition,
    // no trailing selector follows, so arming the window would only swallow
    // the user's next genuine Space/digit.
    compositionEndedAt =
      sawEmptyCompositionUpdate && !candidateSelectionDuringComposition ? now() : null
    sawEmptyCompositionUpdate = false
    candidateSelectionDuringComposition = false
  }
  const handleInput = (event: Event): void => {
    if (event instanceof InputEvent && event.inputType === 'insertCompositionText') {
      return
    }
    active = false
    // Why: real non-composition input means ordinary typing resumed; keeping
    // the post-end window would swallow a legitimate Space/digit.
    compositionEndedAt = null
    sawEmptyCompositionUpdate = false
    candidateSelectionDuringComposition = false
  }
  const markInactive = (): void => {
    active = false
    lastCompositionEventAt = null
    compositionEndedAt = null
    sawEmptyCompositionUpdate = false
    candidateSelectionDuringComposition = false
  }

  terminalElement.addEventListener('compositionstart', markActive, true)
  terminalElement.addEventListener('compositionupdate', updateComposition, true)
  terminalElement.addEventListener('compositionend', handleCompositionEnd, true)
  terminalElement.addEventListener('input', handleInput, true)
  terminalElement.addEventListener('blur', markInactive, true)

  return {
    isActive: () => isActiveAt(now()),
    isCandidateKeyGuardActive,
    noteCandidateSelectionDuringComposition,
    dispose: () => {
      terminalElement.removeEventListener('compositionstart', markActive, true)
      terminalElement.removeEventListener('compositionupdate', updateComposition, true)
      terminalElement.removeEventListener('compositionend', handleCompositionEnd, true)
      terminalElement.removeEventListener('input', handleInput, true)
      terminalElement.removeEventListener('blur', markInactive, true)
    }
  }
}
