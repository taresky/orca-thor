import { describe, expect, it } from 'vitest'
import {
  buildBranchSource,
  buildGitHubTaskSource,
  buildGitLabTaskSource,
  buildLinearTaskSource,
  buildNewBranchSource,
  describeWorkspaceSource,
  isRepoBoundSource,
  resolveSourceRepoId
} from './workspace-source-selection'

describe('workspace source selection', () => {
  it('builds a GitHub PR task source pinned to its repo', () => {
    const source = buildGitHubTaskSource('repo-1', {
      type: 'pr',
      number: 42,
      title: 'Fix login',
      url: 'https://github.com/acme/app/pull/42',
      branchName: 'feature/login',
      isCrossRepository: true
    })
    expect(source).toEqual({
      kind: 'task',
      hostedType: 'pr',
      branchName: 'feature/login',
      isCrossRepository: true,
      item: {
        provider: 'github',
        source: {
          type: 'pr',
          repoId: 'repo-1',
          number: 42,
          title: 'Fix login',
          url: 'https://github.com/acme/app/pull/42'
        }
      }
    })
    expect(resolveSourceRepoId(source)).toBe('repo-1')
  })

  it('omits optional resolve fields when absent on a GitHub issue', () => {
    const source = buildGitHubTaskSource('repo-1', {
      type: 'issue',
      number: 7,
      title: 'Bug',
      url: 'https://github.com/acme/app/issues/7'
    })
    if (source.kind !== 'task') {
      throw new Error('expected task source')
    }
    expect(source.hostedType).toBe('issue')
    expect('branchName' in source).toBe(false)
    expect('isCrossRepository' in source).toBe(false)
  })

  it('builds a GitLab MR task source with mr hostedType', () => {
    const source = buildGitLabTaskSource('repo-2', {
      type: 'mr',
      number: 9,
      title: 'Refactor',
      url: 'https://gitlab.com/acme/app/-/merge_requests/9'
    })
    if (source.kind !== 'task') {
      throw new Error('expected task source')
    }
    expect(source.hostedType).toBe('mr')
    expect(source.item.provider).toBe('gitlab')
    expect(resolveSourceRepoId(source)).toBe('repo-2')
  })

  it('builds a Linear task source that defers repo to the modal', () => {
    const source = buildLinearTaskSource({
      identifier: 'ENG-42',
      title: 'Improve onboarding',
      url: 'https://linear.app/acme/issue/ENG-42'
    })
    if (source.kind !== 'task') {
      throw new Error('expected task source')
    }
    expect(source.hostedType).toBe('linear')
    expect(resolveSourceRepoId(source)).toBeNull()
  })

  it('builds branch and new-branch sources deferring repo to the modal', () => {
    expect(resolveSourceRepoId(buildBranchSource('origin/main', 'main'))).toBeNull()
    expect(resolveSourceRepoId(buildNewBranchSource('main', 'feature-x'))).toBeNull()
  })

  it('treats branch/new-branch and GitHub/GitLab tasks as repo-bound, not Linear or blank', () => {
    expect(isRepoBoundSource({ kind: 'blank' })).toBe(false)
    expect(isRepoBoundSource(buildBranchSource('origin/main', 'main'))).toBe(true)
    expect(isRepoBoundSource(buildNewBranchSource('', 'feature-x'))).toBe(true)
    expect(
      isRepoBoundSource(
        buildGitHubTaskSource('r', { type: 'issue', number: 1, title: 't', url: 'u' })
      )
    ).toBe(true)
    expect(
      isRepoBoundSource(buildGitLabTaskSource('r', { type: 'mr', number: 1, title: 't', url: 'u' }))
    ).toBe(true)
    expect(
      isRepoBoundSource(buildLinearTaskSource({ identifier: 'ENG-1', title: 't', url: 'u' }))
    ).toBe(false)
  })

  it('describes each source kind for the collapsed field', () => {
    expect(describeWorkspaceSource({ kind: 'blank' })).toEqual({ label: 'Blank workspace' })
    expect(describeWorkspaceSource(buildBranchSource('origin/main', 'main'))).toEqual({
      label: 'Branch: main',
      providerIconId: 'branch'
    })
    expect(describeWorkspaceSource(buildNewBranchSource('main', 'feature-x'))).toEqual({
      label: 'New branch: feature-x',
      providerIconId: 'branch'
    })
    expect(
      describeWorkspaceSource(
        buildGitHubTaskSource('r', {
          type: 'issue',
          number: 3,
          title: 'Crash',
          url: 'u'
        })
      )
    ).toEqual({ label: '#3 Crash', providerIconId: 'github' })
    expect(
      describeWorkspaceSource(
        buildGitLabTaskSource('r', { type: 'mr', number: 5, title: 'Speed', url: 'u' })
      )
    ).toEqual({ label: '!5 Speed', providerIconId: 'gitlab' })
    expect(
      describeWorkspaceSource(
        buildLinearTaskSource({ identifier: 'ENG-1', title: 'Ship', url: 'u' })
      )
    ).toEqual({ label: 'ENG-1 Ship', providerIconId: 'linear' })
  })
})
