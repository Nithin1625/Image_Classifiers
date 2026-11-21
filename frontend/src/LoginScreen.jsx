// src/screens/LoginScreen.jsx
import React, { useState } from "react"
import { useGoogleLogin } from "@react-oauth/google"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)

  const googleLogin = useGoogleLogin({
    flow: "auth-code",
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file email profile openid",
    onSuccess: async (codeResponse) => {
      setLoading(true)
      try {
        const res = await fetch(`${window.CLASSIFIER_API_URL || import.meta.env.VITE_API_URL || "http://localhost:8000"}/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: codeResponse.code }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.detail || "Authentication failed with Google.")
        }
        onLogin({
          token: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: data.user,
          authVersion: "2.0_full_drive",
        })
      } catch (err) {
        console.error("Google Auth Exchange Error:", err)
        setErrorMessage(err.message || "Failed to complete Google sign-in.")
      } finally {
        setLoading(false)
      }
    },
    onError: (error) => {
      console.error("Google Sign-In Error:", error)
      setErrorMessage("Google Sign-In was cancelled or failed. Please verify your credentials.")
    },
  })

  const handleSignInClick = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || clientId.includes("YOUR_GOOGLE_CLIENT_ID")) {
      setErrorMessage("Google Client ID is not configured. Please add VITE_GOOGLE_CLIENT_ID in your .env file.")
      return
    }
    googleLogin()
  }

  return (
    <div className="w-full max-w-[420px] mx-auto px-4">
      <Card className="flex flex-col items-center border border-slate-200/90 shadow-sm rounded-2xl bg-white p-7 sm:p-9">
        {/* App Icon */}
        <div className="mb-5 p-3.5 rounded-2xl bg-gradient-to-b from-blue-50 to-blue-100/60 border border-blue-200/70 text-blue-600 shadow-2xs">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>

        {/* Title & Description */}
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1.5 text-center">
          Image Classifier
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 text-center mb-6 leading-relaxed max-w-[300px]">
          Train and test custom image classification models directly in your browser.
        </p>

        {/* Google Sign-in Button */}
        <Button
          variant="outline"
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 h-11 text-sm font-semibold border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 rounded-xl shadow-xs transition-all cursor-pointer active:scale-[0.99]"
          onClick={handleSignInClick}
        >
          {loading ? (
            <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
          )}
          <span>{loading ? "Signing in..." : "Continue with Google"}</span>
        </Button>

        {/* Helpful note */}
        <p className="mt-5 text-xs text-slate-400 text-center leading-relaxed max-w-[280px]">
          Sign in with Google to sync models with Drive.
        </p>
      </Card>

      {/* Alert Dialog: Error notification */}
      <AlertDialog open={!!errorMessage} onOpenChange={(open) => !open && setErrorMessage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign-In Notice</AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorMessage(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
