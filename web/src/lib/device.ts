import { useEffect } from 'react'
import { useReducer, useSpacetimeDB } from 'spacetimedb/react'
import { reducers } from '../module_bindings'

/** Register this screen as a SpacetimeDB device (one identity per device; reducers check the role). */
export function useRegisterDevice(role: 'supervisor' | 'buddy' | 'worker_screen', name: string, workerId = '') {
  const conn = useSpacetimeDB()
  const register = useReducer(reducers.registerDevice)
  useEffect(() => {
    if (!conn.isActive || !name) return
    register({ role, name, workerId }).catch(() => {})
  }, [conn.isActive, role, name, workerId, register])
}
