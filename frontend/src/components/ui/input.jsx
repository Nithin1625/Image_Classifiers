// src/components/ui/input.jsx
import * as React from "react"
import { cn } from "@/lib/utils"

export const Input = React.forwardRef(({ className = "", ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-150 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs",
        className
      )}
      {...props}
    />
  )
})
Input.displayName = "Input"

