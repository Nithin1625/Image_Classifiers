import { useEffect, useRef, useState } from "react"
import { GoogleOAuthProvider, useGoogleLogin, useGoogleOAuth } from "@react-oauth/google"
import { Cloud, Loader2 } from "lucide-react"
import { Button } from "./ui/button"

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
const configured = clientId && !clientId.includes("YOUR_GOOGLE_CLIENT_ID")

function GoogleConnectButton({ onConnected, busy, setBusy }) {
  const { scriptLoadedSuccessfully } = useGoogleOAuth()
  const [error, setError] = useState("")
  function handleError() {
    setBusy(false)
    setError("Google sign-in was closed or could not start. You can try again.")
  }

  const signIn = useGoogleLogin({
    flow: "auth-code",
    scope: "https://www.googleapis.com/auth/drive email profile openid",
    onError: handleError,
    onNonOAuthError: handleError,
    onSuccess: async ({ code }) => {
      try {
        const response = await fetch(`${window.CLASSIFIER_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8000"}/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
        const data = await response.json()
        if (!response.ok || !data.access_token) {
          throw new Error(data.detail || "Google sign-in could not be completed.")
        }
        onConnected({
          token: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: data.user,
        })
      } catch (err) {
        setError(err.message)
        setBusy(false)
      }
    },
  })

  return (
    <>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="button" disabled={busy || !scriptLoadedSuccessfully} onClick={() => {
        setError("")
        setBusy(true)
        try {
          signIn()
        } catch {
          handleError()
        }
      }}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {busy ? "Connecting…" : scriptLoadedSuccessfully ? "Continue with Google" : "Loading Google…"}
      </Button>
    </>
  )
}

export default function DriveConnectDialog({ purpose, onConnected, onCancel }) {
  const dialog = useRef(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="drive-connect"
      aria-labelledby="drive-connect-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <Cloud className="size-6 text-blue-600" aria-hidden="true" />
      <h2 id="drive-connect-title">Connect Google Drive</h2>
      <p>{purpose === "save"
        ? "Sign in to save your current project to Google Drive."
        : "Sign in to browse models and project folders in Google Drive."}</p>
      <div className="drive-connect-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        {configured ? (
          <GoogleOAuthProvider clientId={clientId}>
            <GoogleConnectButton onConnected={onConnected} busy={busy} setBusy={setBusy} />
          </GoogleOAuthProvider>
        ) : (
          <p role="alert" className="text-sm text-red-700">Google Drive is unavailable. Configure VITE_GOOGLE_CLIENT_ID to connect.</p>
        )}
      </div>
    </dialog>
  )
}
