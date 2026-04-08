import { create } from "zustand"
import { API_BASE } from "@/lib/constants"

interface AuthState {
  token: string | null
  passwordRequired: boolean
  checking: boolean
  // Actions
  checkStatus: () => Promise<void>
  login: (password: string) => Promise<boolean>
  logout: () => void
}

function loadToken(): string | null {
  if (typeof window === "undefined") return null
  const t = sessionStorage.getItem("convict_token")
  if (!t) return null
  // Verify not expired (ts is first segment)
  const ts = parseInt(t.split(".")[0] ?? "0")
  if (Date.now() / 1000 - ts > 86400) {
    sessionStorage.removeItem("convict_token")
    return null
  }
  return t
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: loadToken(),
  passwordRequired: false,
  checking: false,

  checkStatus: async () => {
    set({ checking: true })
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/status`)
      if (res.ok) {
        const data = await res.json()
        set({ passwordRequired: data.password_required })
      }
    } catch {}
    finally { set({ checking: false }) }
  },

  login: async (password: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) return false
      const data = await res.json()
      sessionStorage.setItem("convict_token", data.token)
      set({ token: data.token })
      return true
    } catch {
      return false
    }
  },

  logout: () => {
    sessionStorage.removeItem("convict_token")
    set({ token: null })
  },
}))

export function useIsAuthed(): boolean {
  const { token, passwordRequired } = useAuthStore()
  if (!passwordRequired) return true  // no password set = always authed
  return !!token
}
