// src/components/ui/alert.jsx
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
    "relative w-full rounded-xl border px-4 py-3 text-sm [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:text-foreground [&>svg~*]:pl-7 transition-all duration-150 shadow-xs",
    {
        variants: {
            variant: {
                default: "bg-white border-slate-200 text-slate-800",
                destructive: "border-red-200 bg-red-50 text-red-800 [&>svg]:text-red-500",
                success: "border-emerald-200 bg-emerald-50 text-emerald-800 [&>svg]:text-emerald-600",
                info: "border-blue-200 bg-blue-50 text-blue-800 [&>svg]:text-blue-600",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
)

export function Alert({ className, variant, ...props }) {
    return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({ className, ...props }) {
    return <h5 className={cn("mb-0.5 font-semibold text-sm leading-snug", className)} {...props} />
}

export function AlertDescription({ className, ...props }) {
    return <div className={cn("text-xs leading-relaxed text-slate-600 [&_p]:leading-relaxed", className)} {...props} />
}
