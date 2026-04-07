"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getTank, listFish, listSchedules } from "@/lib/api"
import { useTankStore } from "@/store/tankStore"
import { StepTank } from "./StepTank"
import { StepFish } from "./StepFish"
import { StepSchedules } from "./StepSchedules"

const STEPS = ["Tank", "Fish", "Schedules"] as const
type Step = 0 | 1 | 2

export function SetupWizard() {
  const [step, setStep] = useState<Step>(0)
  const [checking, setChecking] = useState(true)
  const router = useRouter()
  const { setTank, setFish, setSchedules } = useTankStore()

  // On mount: check if already configured → redirect to dashboard
  useEffect(() => {
    async function check() {
      try {
        const [tank, fish, schedules] = await Promise.all([
          getTank(),
          listFish(),
          listSchedules(),
        ])
        setTank(tank)
        setFish(fish)
        setSchedules(schedules)
        // If coming from dashboard, stay on setup to allow editing
        const fromDashboard = document.referrer.includes("/dashboard") ||
          window.location.search.includes("from=dashboard")
        // Redirect as soon as a tank exists — fish appear automatically, no setup required
        if (tank && !fromDashboard) {
          router.replace("/dashboard")
          return
        }
      } catch {
        // 404 = no tank yet, start from step 0
      } finally {
        setChecking(false)
      }
    }
    check()
  }, [])

  const next = () => setStep((s) => Math.min(s + 1, 2) as Step)
  const prev = () => setStep((s) => Math.max(s - 1, 0) as Step)
  const finish = () => router.push("/dashboard")

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        connecting…
      </div>
    )
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <span className="text-[9px] text-muted-foreground tracking-widest uppercase block mb-1">Convict</span>
        <h1 className="text-2xl font-medium tracking-tight">Initialize Tank</h1>
        <p className="text-[11px] text-muted-foreground mt-1">
          Configure your known world. The intelligence engine will use this as its prior.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] transition-colors
              ${i === step ? "bg-primary/15 text-primary border border-primary/30" :
                i < step ? "text-primary/70" : "text-muted-foreground"}`}>
              <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[9px]
                ${i < step ? "border-primary bg-primary text-primary-foreground" :
                  i === step ? "border-primary text-primary" :
                  "border-border text-muted-foreground"}`}>
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-6 transition-colors ${i < step ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded p-6">
        {step === 0 && <StepTank onNext={next} />}
        {step === 1 && <StepFish onNext={next} onBack={prev} />}
        {step === 2 && <StepSchedules onFinish={finish} onBack={prev} />}
      </div>
    </div>
  )
}
