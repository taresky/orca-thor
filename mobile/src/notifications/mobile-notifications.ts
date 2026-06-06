import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import { loadPushNotificationsEnabled } from '../storage/preferences'
import { buildLocalNotificationData, type DesktopNotificationSource } from './notification-routing'

type NotificationEvent = {
  type: 'notification'
  source: DesktopNotificationSource
  title: string
  body: string
  worktreeId?: string
  notificationId?: string
}

type DismissNotificationEvent = {
  type: 'dismiss'
  notificationId: string
}

type SubscribeResult = {
  type: 'ready'
  subscriptionId: string
}

const scheduledNotificationIdsByHostAndNotificationId = new Map<string, string>()
// Why: serialize show/dismiss per stored key so an interleaved dismiss between
// the map-delete and the scheduleNotificationAsync resolution cannot silently
// no-op and leave the new OS notification undismissable.
const pendingOperationsByStoredKey = new Map<string, Promise<void>>()

function getStoredNotificationKey(hostId: string, notificationId: string): string {
  return `${encodeURIComponent(hostId)}:${encodeURIComponent(notificationId)}`
}

function runSerializedByStoredKey(storedKey: string, task: () => Promise<void>): Promise<void> {
  const previous = pendingOperationsByStoredKey.get(storedKey) ?? Promise.resolve()
  const next = previous.then(task, task)
  pendingOperationsByStoredKey.set(storedKey, next)
  void next.finally(() => {
    if (pendingOperationsByStoredKey.get(storedKey) === next) {
      pendingOperationsByStoredKey.delete(storedKey)
    }
  })
  return next
}

export type NotificationPermissionState = {
  granted: boolean
  status: string
  canAskAgain: boolean
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync()
  return {
    granted: status === 'granted',
    status,
    canAskAgain
  }
}

// Why: permissions must be requested before scheduling any local notification.
// Read the OS state every time because users can change it in Settings while
// Orca remains alive in the background.
export async function ensureNotificationPermissions(): Promise<boolean> {
  const existing = await getNotificationPermissionState()
  if (existing.granted) {
    return true
  }

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

function configureNotificationChannel(): void {
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('orca-desktop', {
      name: 'Desktop Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      lightColor: '#6366f1'
    })
  }
}

async function showLocalNotification(event: NotificationEvent, hostId: string): Promise<void> {
  const enabled = await loadPushNotificationsEnabled()
  if (!enabled) {
    return
  }

  const granted = await ensureNotificationPermissions()
  if (!granted) {
    return
  }

  const storedKey = event.notificationId
    ? getStoredNotificationKey(hostId, event.notificationId)
    : null

  const schedule = async (): Promise<void> => {
    const previousIdentifier = storedKey
      ? scheduledNotificationIdsByHostAndNotificationId.get(storedKey)
      : undefined
    if (storedKey && previousIdentifier) {
      await Notifications.dismissNotificationAsync(previousIdentifier).catch(() => {})
      scheduledNotificationIdsByHostAndNotificationId.delete(storedKey)
    }

    const scheduledIdentifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body: event.body,
        data: buildLocalNotificationData(event, hostId),
        ...(Platform.OS === 'android' ? { channelId: 'orca-desktop' } : {})
      },
      trigger: null
    })
    if (storedKey) {
      scheduledNotificationIdsByHostAndNotificationId.set(storedKey, scheduledIdentifier)
    }
  }

  if (storedKey) {
    await runSerializedByStoredKey(storedKey, schedule)
  } else {
    await schedule()
  }
}

async function dismissLocalNotification(
  event: DismissNotificationEvent,
  hostId: string
): Promise<void> {
  if (!event.notificationId) {
    return
  }
  const storedKey = getStoredNotificationKey(hostId, event.notificationId)
  await runSerializedByStoredKey(storedKey, async () => {
    const identifier = scheduledNotificationIdsByHostAndNotificationId.get(storedKey)
    if (!identifier) {
      return
    }
    scheduledNotificationIdsByHostAndNotificationId.delete(storedKey)
    await Notifications.dismissNotificationAsync(identifier).catch(() => {})
  })
}

// Why: each host connection gets its own notification subscription. When the
// connection drops, the unsubscribe function cleans up the streaming RPC.
// Returns an unsubscribe function.
export function subscribeToDesktopNotifications(client: RpcClient, hostId: string): () => void {
  configureNotificationChannel()

  let subscriptionId: string | null = null
  let disposed = false
  function unsubscribeServer(id: string) {
    if (client.getState() === 'connected') {
      client.sendRequest('notifications.unsubscribe', { subscriptionId: id }).catch(() => {})
    }
  }

  const unsubscribeStream = client.subscribe('notifications.subscribe', {}, (data: unknown) => {
    const event = data as
      | NotificationEvent
      | DismissNotificationEvent
      | SubscribeResult
      | { type: 'end' }
    if (event.type === 'ready') {
      subscriptionId = (event as SubscribeResult).subscriptionId
      if (disposed) {
        unsubscribeServer(subscriptionId)
        unsubscribeStream()
      }
      return
    }
    if (event.type === 'end') {
      if (disposed) {
        unsubscribeStream()
      }
      return
    }
    if (disposed) {
      return
    }
    if (event.type === 'notification') {
      void showLocalNotification(event as NotificationEvent, hostId)
    } else if (event.type === 'dismiss') {
      void dismissLocalNotification(event as DismissNotificationEvent, hostId)
    }
  })

  return () => {
    disposed = true
    // Why: the client may already be closed when this cleanup runs (component
    // unmount races with disconnect). sendRequest rejects immediately on a
    // closed client — swallow it since server-side cleanup happens via
    // connection-close anyway.
    // Always drop the local stream first; readiness can race unmount and we
    // must not retain the callback while waiting for a subscription id.
    unsubscribeStream()
    if (subscriptionId) {
      unsubscribeServer(subscriptionId)
    }
  }
}
