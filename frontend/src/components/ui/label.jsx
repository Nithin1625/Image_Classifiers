// src/components/ui/label.jsx
import * as React from "react"
import { cn } from "@/lib/utils"

export function Label({ className = "", children, ...props }) {
  return (
    <label className={cn("text-xs font-semibold text-slate-700 select-none", className)} {...props}>
      {children}
    </label>
  )
}

