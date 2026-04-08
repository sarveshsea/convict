interface Props {
  message: string
  height?: "sm" | "md" | "lg"
}

export function EmptyState({ message, height = "md" }: Props) {
  const h = height === "sm" ? "h-12" : height === "lg" ? "h-32" : "h-20"
  return (
    <div className={`flex items-center justify-center ${h} text-caption text-muted-foreground`}>
      {message}
    </div>
  )
}
