import type { ReactNode } from 'react'
import { RpcClientContext, type RpcClientContextValue } from './client-context'

/** Carries the primary app's host-client store into Thor's second Fabric root. */
export function RpcClientContextBridge({
  value,
  children
}: {
  value: RpcClientContextValue
  children: ReactNode
}): React.JSX.Element {
  return <RpcClientContext.Provider value={value}>{children}</RpcClientContext.Provider>
}
