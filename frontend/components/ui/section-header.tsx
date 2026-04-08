interface Props {
  label: string
  count?: number
  countColor?: string
  right?: React.ReactNode
}

export function SectionHeader({ label, count, countColor = "text-muted-foreground", right }: Props) {
  return (
    <div className="px-3 py-2 border-b border-border/40 shrink-0 flex items-center justify-between">
      <span className="text-label text-muted-foreground">{label}</span>
      {right ?? (count !== undefined && count > 0 && (
        <span className={`text-label ${countColor}`}>{count}</span>
      ))}
    </div>
  )
}
