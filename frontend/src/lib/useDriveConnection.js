import { useCallback, useEffect, useRef, useState } from "react"

const SESSION_KEY = "auth_session"

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY))
    return session?.authVersion === "2.0_full_drive" ? session : null
  } catch {
    return null
  }
}

function usableToken(session) {
  const expiresAt = session?.lastRefreshed + Number(session?.expiresIn || 3600) * 1000
  return expiresAt > Date.now() + 60_000 ? session.token : null
}

export function useDriveConnection(activeDriveProject) {
  const [session, setSession] = useState(readSession)
  const sessionRef = useRef(session)
  const refreshRef = useRef(null)
  const pending = useRef(null)
  const requestId = useRef(0)
  const [request, setRequest] = useState(null)

  const saveSession = useCallback((value) => {
    sessionRef.current = value
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value))
    else localStorage.removeItem(SESSION_KEY)
    setSession(value)
  }, [])

  const refresh = useCallback(async () => {
    const current = sessionRef.current
    if (!current?.refreshToken) return null
    if (refreshRef.current?.session === current) return refreshRef.current.promise

    const promise = (async () => {
      try {
        const response = await fetch(`${window.CLASSIFIER_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8000"}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: current.refreshToken }),
        })
        const data = await response.json()
        if (sessionRef.current !== current) return null
        if (!response.ok || !data.access_token) return null
        saveSession({
          ...current,
          token: data.access_token,
          expiresIn: data.expires_in,
          lastRefreshed: Date.now(),
        })
        return data.access_token
      } catch {
        return null
      }
    })()
    refreshRef.current = { session: current, promise }
    try {
      return await promise
    } finally {
      if (refreshRef.current?.promise === promise) refreshRef.current = null
    }
  }, [saveSession])

  useEffect(() => {
    window.__refreshGoogleToken = refresh
    return () => { delete window.__refreshGoogleToken }
  }, [refresh])

  useEffect(() => {
    if (!activeDriveProject || !session?.refreshToken) return
    const expiresAt = session.lastRefreshed + Number(session.expiresIn || 3600) * 1000
    const timer = setTimeout(refresh, Math.max(0, expiresAt - Date.now() - 120_000))
    return () => clearTimeout(timer)
  }, [activeDriveProject, refresh, session])

  const requestAccess = useCallback(async (purpose, { reconnect = false } = {}) => {
    if (!reconnect) {
      const token = usableToken(sessionRef.current) || await refresh()
      if (token) return token
    }
    if (!pending.current) {
      let resolve
      const promise = new Promise((finish) => { resolve = finish })
      pending.current = { promise, resolve }
      setRequest({ purpose, id: ++requestId.current })
    }
    return pending.current.promise
  }, [refresh])

  function finish(token) {
    pending.current?.resolve(token)
    pending.current = null
    setRequest(null)
  }

  return {
    token: usableToken(session),
    request,
    requestAccess,
    connect(auth) {
      saveSession({ ...auth, authVersion: "2.0_full_drive", lastRefreshed: Date.now() })
      finish(auth.token)
    },
    cancel: () => finish(null),
    disconnect: () => saveSession(null),
  }
}
