"use client"
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center h-screen gap-3 p-6 text-center">
          <p className="text-caption font-mono text-destructive">
            {this.state.error.message || "Something went wrong"}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-label text-muted-foreground border border-border rounded px-2 py-1 hover:text-foreground"
          >
            retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
