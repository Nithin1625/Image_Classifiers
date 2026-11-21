// src/components/ui/progress.jsx
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export const Progress = React.forwardRef(
  ({ className, value = 0, indicatorClassName, ...props }, ref) => {
    const safeValue = Math.min(Math.max(0, value ?? 0), 100)

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-slate-100",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "h-full w-full flex-1 bg-primary transition-all duration-300 ease-in-out rounded-full",
            indicatorClassName
          )}
          style={{ transform: `translateX(-${100 - safeValue}%)` }}
        />
      </div>
    )
  }
)
Progress.displayName = "Progress"

export default Progress
