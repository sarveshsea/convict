import { redirect } from "next/navigation"

// Server component: check if tank exists, route accordingly
async function hasTank(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/tank`,
      { cache: "no-store" }
    )
    return res.ok
  } catch {
    return false
  }
}

export default async function RootPage() {
  const configured = await hasTank()
  redirect(configured ? "/dashboard" : "/setup")
}
