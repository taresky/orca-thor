import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

const MOBILE_DICTATION_KEEP_AWAKE_TAG_PREFIX = 'orca-mobile-dictation'

let nextOwnerId = 0

function createOwnerId(): string {
  nextOwnerId += 1
  return `${Date.now()}-${nextOwnerId}-${Math.random().toString(36).slice(2)}`
}

export class MobileDictationKeepAwakeOwner {
  private readonly ownerId = createOwnerId()
  private acquiredTag: string | null = null
  private operation: Promise<void> = Promise.resolve()

  acquire(dictationId: string): Promise<void> {
    const tag = this.createTag(dictationId)
    const operation = this.operation.then(async () => {
      if (this.acquiredTag === tag) {
        return
      }
      if (this.acquiredTag) {
        const previousTag = this.acquiredTag
        this.acquiredTag = null
        await deactivateKeepAwake(previousTag).catch(() => undefined)
      }
      await activateKeepAwakeAsync(tag)
      this.acquiredTag = tag
    })
    this.operation = operation.catch(() => undefined)
    return operation
  }

  release(dictationId?: string): Promise<void> {
    const targetTag = dictationId ? this.createTag(dictationId) : null
    const operation = this.operation.then(async () => {
      const tag = this.acquiredTag
      if (!tag || (targetTag && tag !== targetTag)) {
        return
      }
      this.acquiredTag = null
      await deactivateKeepAwake(tag)
    })
    this.operation = operation.catch(() => undefined)
    return operation
  }

  private createTag(dictationId: string): string {
    return `${MOBILE_DICTATION_KEEP_AWAKE_TAG_PREFIX}:${this.ownerId}:${dictationId}`
  }
}

export function createMobileDictationKeepAwakeOwner(): MobileDictationKeepAwakeOwner {
  return new MobileDictationKeepAwakeOwner()
}
