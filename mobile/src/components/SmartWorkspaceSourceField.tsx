import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  X
} from 'lucide-react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { SmartNameSelection } from '../tasks/mobile-composer-source-types'
import type { SmartModeAvailabilityInput } from '../tasks/mobile-smart-source-modes'
import type { PasteRepoCandidate } from '../tasks/smart-source-paste-intent'
import type { MobileComposerSource } from '../tasks/use-mobile-composer-source'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { SmartWorkspaceSourceDrawer } from './SmartWorkspaceSourceDrawer'
import { TaskProviderLogo } from './TaskProviderLogo'

type Props = {
  visible: boolean
  composer: MobileComposerSource
  client: RpcClient | null
  availability: SmartModeAvailabilityInput
  repoId: string | null
  repos: readonly PasteRepoCandidate[]
  linearWorkspaceId?: string | null
  sshReady: boolean
  label: string
  disabled?: boolean
  onRepoChange: (repoId: string) => void
  onBeforeOpen?: () => void
}

function SelectionIcon({ kind }: { kind: SmartNameSelection['kind'] }) {
  if (kind === 'github-pr') {
    return <GitPullRequest size={15} color={colors.textSecondary} />
  }
  if (kind === 'gitlab-mr') {
    return <GitMerge size={15} color={colors.textSecondary} />
  }
  if (kind === 'github-issue' || kind === 'gitlab-issue') {
    return <CircleDot size={15} color={colors.textSecondary} />
  }
  if (kind === 'branch') {
    return <GitBranch size={15} color={colors.textSecondary} />
  }
  return <TaskProviderLogo provider="linear" size={15} color={colors.textSecondary} />
}

export function SmartWorkspaceSourceField({
  visible,
  composer,
  client,
  availability,
  repoId,
  repos,
  linearWorkspaceId,
  sshReady,
  label,
  disabled,
  onRepoChange,
  onBeforeOpen
}: Props) {
  const [showDrawer, setShowDrawer] = useState(false)
  const selection = composer.smartNameSelection

  function openDrawer(): void {
    if (disabled) {
      return
    }
    onBeforeOpen?.()
    setShowDrawer(true)
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} <Text style={styles.labelHint}>[Optional]</Text>
      </Text>
      {selection ? (
        <View style={styles.pill}>
          <SelectionIcon kind={selection.kind} />
          <Text style={styles.pillLabel} numberOfLines={1}>
            {selection.label}
          </Text>
          {selection.url ? (
            <Pressable
              hitSlop={6}
              onPress={() => selection.url && void Linking.openURL(selection.url)}
            >
              <ExternalLink size={15} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable hitSlop={6} onPress={composer.handleClearSmartNameSelection}>
            <X size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.input, disabled && styles.disabled]}
          disabled={disabled}
          onPress={openDrawer}
        >
          <Text
            style={[styles.inputText, !composer.name && styles.inputPlaceholder]}
            numberOfLines={1}
          >
            {composer.name || 'Type a name or search a source'}
          </Text>
        </Pressable>
      )}

      <SmartWorkspaceSourceDrawer
        visible={visible && showDrawer}
        client={client}
        composer={composer}
        availability={availability}
        repoId={repoId}
        repos={repos}
        linearWorkspaceId={linearWorkspaceId}
        sshReady={sshReady}
        onRepoChange={onRepoChange}
        onClose={() => setShowDrawer(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.xs
  },
  labelHint: {
    fontWeight: '400',
    color: colors.textMuted
  },
  input: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  disabled: {
    opacity: 0.55
  },
  inputText: {
    fontSize: typography.bodySize,
    color: colors.textPrimary
  },
  inputPlaceholder: {
    color: colors.textMuted
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  pillLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.textPrimary
  }
})
