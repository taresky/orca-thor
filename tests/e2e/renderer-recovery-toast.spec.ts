import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'

const SESSION_NOTIFICATION_KEY = 'orca:renderer-recovery-notification:session'
const LOCAL_NOTIFICATION_KEY = 'orca:renderer-recovery-notification:local'

type RecoveryReason = 'lazy-chunk-reload' | 'lazy-chunk-app-restart' | 'memory-pressure-reload'

async function waitForRendererBoot(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 30_000 })
}

async function seedRecoveryMarker(
  page: Page,
  scope: 'session' | 'local',
  reason: RecoveryReason
): Promise<void> {
  await page.evaluate(
    ({ key, selectedReason, storageScope }) => {
      const storage = storageScope === 'session' ? window.sessionStorage : window.localStorage
      storage.setItem(
        key,
        JSON.stringify({ version: 1, reason: selectedReason, createdAtMs: Date.now() })
      )
    },
    {
      key: scope === 'session' ? SESSION_NOTIFICATION_KEY : LOCAL_NOTIFICATION_KEY,
      selectedReason: reason,
      storageScope: scope
    }
  )
}

test.use({ seedTestRepo: false })

test('explains guarded renderer recovery once after reload or restart markers', async ({
  orcaPage
}) => {
  await waitForRendererBoot(orcaPage)

  await expect(orcaPage.getByText('Orca refreshed to recover')).toHaveCount(0)
  await expect(orcaPage.getByText('Orca restarted to recover')).toHaveCount(0)

  await seedRecoveryMarker(orcaPage, 'session', 'memory-pressure-reload')
  await orcaPage.reload()
  await waitForRendererBoot(orcaPage)

  await expect(orcaPage.getByText('Orca refreshed to recover')).toBeVisible()
  await expect(
    orcaPage.getByText('Memory usage was critically high, so Orca refreshed the app shell.')
  ).toBeVisible()
  await expect
    .poll(() =>
      orcaPage.evaluate((key) => window.sessionStorage.getItem(key), SESSION_NOTIFICATION_KEY)
    )
    .toBeNull()

  // Why: a restart is more disruptive than a renderer reload, so if both
  // markers somehow survive boot the user should see the restart explanation.
  await seedRecoveryMarker(orcaPage, 'session', 'lazy-chunk-reload')
  await seedRecoveryMarker(orcaPage, 'local', 'lazy-chunk-app-restart')
  await orcaPage.reload()
  await waitForRendererBoot(orcaPage)

  await expect(orcaPage.getByText('Orca restarted to recover')).toBeVisible()
  await expect(
    orcaPage.getByText('A loading error repeated after refresh, so Orca restarted once.')
  ).toBeVisible()
  await expect
    .poll(() =>
      orcaPage.evaluate((key) => window.sessionStorage.getItem(key), SESSION_NOTIFICATION_KEY)
    )
    .toBeNull()
  await expect
    .poll(() =>
      orcaPage.evaluate((key) => window.localStorage.getItem(key), LOCAL_NOTIFICATION_KEY)
    )
    .toBeNull()

  try {
    await orcaPage.evaluate(async () => {
      await window.api.settings.set({ uiLanguage: 'es' })
    })
    await seedRecoveryMarker(orcaPage, 'session', 'lazy-chunk-reload')
    await orcaPage.reload()
    await waitForRendererBoot(orcaPage)

    await expect(orcaPage.getByText('Orca se recargó para recuperarse')).toBeVisible()
    await expect(
      orcaPage.getByText('Se recuperó de un error de carga recargando la interfaz de la app.')
    ).toBeVisible()
    await expect
      .poll(() =>
        orcaPage.evaluate((key) => window.sessionStorage.getItem(key), SESSION_NOTIFICATION_KEY)
      )
      .toBeNull()
  } finally {
    await orcaPage.evaluate(async () => {
      await window.api.settings.set({ uiLanguage: 'en' })
    })
  }
})
