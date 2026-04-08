interface Props {
  value: number   // 0–1
  className?: string
}

function confColor(v: number) {
  if (v >= 0.7) return "bg-status-healthy"
  if (v >= 0.4) return "bg-status-warning"
  return "bg-status-critical"
}

export function ConfidenceBar({ value, className = "" }: Props) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex-1 h-px bg-border rounded-full overflow-hidden">
        <div
          className={`h-full ${confColor(value)} transition-all duration-300`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-caption text-muted-foreground tabular-nums shrink-0" data-value>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  )
}
