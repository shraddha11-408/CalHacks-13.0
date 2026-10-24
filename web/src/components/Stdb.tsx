import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SpacetimeDBProvider } from 'spacetimedb/react'
import { api, type PublicConfig } from '../lib/api'
import { DbConnection } from '../module_bindings'

const TOKEN_KEY = 'stepwise-stdb-token'

/** Connects to SpacetimeDB (local server or Maincloud, chosen in config.yaml) and renders children inside it. */
export function StdbGate({ children }: { children: (error: string | null) => ReactNode }) {
  const [cfg, setCfg] = useState<PublicConfig | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.config().then(setCfg).catch((e) => setErr(`Edge app not reachable: ${e.message}`))
  }, [])
  const builder = useMemo(() => {
    if (!cfg) return null
    let token: string | undefined
    try {
      token = localStorage.getItem(TOKEN_KEY) ?? undefined
    } catch {
      /* none */
    }
    return DbConnection.builder()
      .withUri(cfg.spacetimedb.uri)
      .withDatabaseName(cfg.spacetimedb.db)
      .withToken(token)
      .onConnect((_c, _id, tok) => {
        try {
          localStorage.setItem(TOKEN_KEY, tok)
        } catch {
          /* ok */
        }
      })
      .onConnectError((_c, e) => setErr(`SpacetimeDB: ${e.message}`))
  }, [cfg])

  if (err && !builder) return <p className="muted">{err}</p>
  if (!builder) return <p className="muted">Connecting…</p>
  return <SpacetimeDBProvider connectionBuilder={builder}>{children(err)}</SpacetimeDBProvider>
}
