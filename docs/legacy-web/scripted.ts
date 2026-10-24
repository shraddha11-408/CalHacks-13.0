import { useEffect, useState } from 'react'
import { WORKER_SCRIPT } from './mock'

/** Plays the scripted coach loop. Replaced by the live edge verdict stream later. */
export function useScriptedLoop(periodMs = 4200) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % WORKER_SCRIPT.length), periodMs)
    return () => clearInterval(id)
  }, [periodMs])
  return WORKER_SCRIPT[i]
}
