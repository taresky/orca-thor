import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { Plus } from 'lucide-react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import {
  buildNewBranchSource,
  type WorkspaceSource,
  type WorkspaceSourceTab
} from '../tasks/workspace-source-selection'
import {
  useWorkspaceSourceSearch,
  type WorkspaceSourceSearchResult
} from '../tasks/use-workspace-source-search'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { BottomDrawer, BOTTOM_DRAWER_HIDE_DURATION_MS } from './BottomDrawer'
import { WorkspaceSourceResultRow } from './WorkspaceSourceResultRow'

const TAB_LABELS: Record<WorkspaceSourceTab, string> = {
  branch: 'Branch',
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

const SEARCH_PLACEHOLDERS: Record<WorkspaceSourceTab, string> = {
  branch: 'Search branches',
  github: 'Search issues (type is:pr for PRs)',
  gitlab: 'Search issues and MRs',
  linear: 'Search Linear issues'
}

type Props = {
  visible: boolean
  client: RpcClient | null
  tasksSupported: boolean
  availableProviders: readonly TaskProvider[]
  repoId: string | null
  sshReady: boolean
  linearWorkspaceId?: string | null
  onSelect: (source: WorkspaceSource) => void
  onClose: () => void
}

type Row =
  | { kind: 'reset' }
  | { kind: 'new-branch'; name: string }
  | { kind: 'result'; result: WorkspaceSourceSearchResult }

export function WorkspaceSourcePickerDrawer({
  visible,
  client,
  tasksSupported,
  availableProviders,
  repoId,
  sshReady,
  linearWorkspaceId,
  onSelect,
  onClose
}: Props) {
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<WorkspaceSourceTab>('branch')
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawerVisible = visible && !closing

  const tabs = useMemo<WorkspaceSourceTab[]>(
    () => ['branch', ...(tasksSupported ? availableProviders : [])],
    [availableProviders, tasksSupported]
  )
  const effectiveTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? 'branch')

  useEffect(() => {
    if (visible) {
      setClosing(false)
      setQuery('')
      setActiveTab('branch')
    }
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [visible])

  // Every provider search (incl. repo.searchRefs) requires the mobile.tasks
  // capability, so gate all search on it. Linear is repo/SSH-independent; the
  // other tabs need a connected repo.
  const searchActive = tasksSupported && (effectiveTab === 'linear' || sshReady)
  const { results, loading, error, needsGitHubRemote } = useWorkspaceSourceSearch({
    client,
    enabled: visible && searchActive,
    activeTab: effectiveTab,
    query,
    repoId,
    linearWorkspaceId
  })

  const finishClose = useCallback(() => {
    setClosing(false)
    onClose()
  }, [onClose])

  const selectThenClose = useCallback(
    (source: WorkspaceSource) => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
      setClosing(true)
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null
        onClose()
        onSelect(source)
      }, BOTTOM_DRAWER_HIDE_DURATION_MS)
    },
    [onClose, onSelect]
  )

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [{ kind: 'reset' }]
    const trimmed = query.trim()
    // Gate on !loading so the row is computed from settled results, not the
    // previous query's debounce-lagged set.
    if (effectiveTab === 'branch' && trimmed && !loading) {
      const hasExact = results.some(
        (result) => result.source.kind === 'branch' && result.source.localBranchName === trimmed
      )
      if (!hasExact) {
        list.push({ kind: 'new-branch', name: trimmed })
      }
    }
    for (const result of results) {
      list.push({ kind: 'result', result })
    }
    return list
  }, [effectiveTab, query, results, loading])

  const branchHint =
    effectiveTab === 'branch' && !query.trim()
      ? tasksSupported
        ? 'Type to search branches.'
        : 'Type a name to create a new branch.'
      : null
  const showEmpty = !loading && !error && !needsGitHubRemote && searchActive && results.length === 0

  return (
    <BottomDrawer
      visible={drawerVisible}
      onClose={finishClose}
      dragContentToDismiss={false}
      contentScrollable={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Start from</Text>
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder={SEARCH_PLACEHOLDERS[effectiveTab]}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const selected = tab === effectiveTab
          return (
            <Pressable
              key={tab}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {TAB_LABELS[tab]}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {tasksSupported && !sshReady && effectiveTab !== 'linear' ? (
        <Text style={styles.notice}>Connect the repository to search sources.</Text>
      ) : needsGitHubRemote ? (
        <Text style={styles.notice}>
          This SSH repo needs a GitHub remote to list issues and PRs.
        </Text>
      ) : error ? (
        <Text style={styles.errorNotice}>{error}</Text>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row, index) =>
          row.kind === 'result' ? row.result.id : `${row.kind}:${index}`
        }
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        ListFooterComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : branchHint ? (
            <Text style={styles.empty}>{branchHint}</Text>
          ) : showEmpty ? (
            <Text style={styles.empty}>No results found.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'reset') {
            return (
              <WorkspaceSourceResultRow
                title="Blank workspace"
                subtitle="Start without a linked source"
                onPress={() => selectThenClose({ kind: 'blank' })}
              />
            )
          }
          if (item.kind === 'new-branch') {
            return (
              <Pressable
                style={({ pressed }) => [styles.newBranchRow, pressed && styles.rowPressed]}
                onPress={() => selectThenClose(buildNewBranchSource('', item.name))}
              >
                <Plus size={15} color={colors.accentBlue} />
                <Text style={styles.newBranchText} numberOfLines={1}>
                  Create new branch “{item.name}”
                </Text>
              </Pressable>
            )
          }
          return (
            <WorkspaceSourceResultRow
              title={item.result.title}
              subtitle={item.result.subtitle}
              status={item.result.status}
              onPress={() => selectThenClose(item.result.source)}
            />
          )
        }}
      />
    </BottomDrawer>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary
  },
  search: {
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  tabSelected: {
    backgroundColor: colors.bgPanel,
    borderColor: colors.textSecondary
  },
  tabText: {
    fontSize: 13,
    color: colors.textSecondary
  },
  tabTextSelected: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  notice: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  errorNotice: {
    fontSize: 12,
    color: colors.statusRed,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm
  },
  list: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden',
    maxHeight: 420,
    flexGrow: 0
  },
  loading: {
    paddingVertical: spacing.lg,
    alignItems: 'center'
  },
  empty: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13
  },
  newBranchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  newBranchText: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.accentBlue,
    fontWeight: '600'
  }
})
