// src/components/ui/button.jsx
import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

export const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-45 cursor-pointer select-none active:scale-[0.99]",
    {
        variants: {
            variant: {
                default: "bg-blue-600 text-white shadow-xs shadow-blue-500/20 hover:bg-blue-700 active:bg-blue-800",
                destructive: "bg-red-600 text-white shadow-xs shadow-red-500/20 hover:bg-red-700 active:bg-red-800",
                outline: "border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 active:bg-slate-100/70",
                secondary: "bg-secondary text-secondary-foreground shadow-2xs hover:bg-slate-200/80 active:bg-slate-200",
                ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200/60",
                link: "text-blue-600 underline-offset-4 hover:underline",
            },
            size: {
                default: "h-9.5 px-4 py-2",
                sm: "h-8 rounded-lg px-2.5 text-xs",
                lg: "h-11 rounded-xl px-6 text-sm font-semibold",
                icon: "h-8 w-8 rounded-lg",
            },
        },
        defaultVariants: {
            variant: "outline",
            size: "default",
        },
    }
)

export const Button = React.forwardRef(({ className, variant = "outline", size, ...props }, ref) => {
    return (
        <button
            ref={ref}
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    )
})
Button.displayName = "Button"
