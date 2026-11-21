// src/components/ui/field.jsx
import * as React from "react"

export function FieldGroup({ className = "", children, ...props }) {
  return (
    <div className={`flex flex-col gap-3.5 my-2 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function Field({ className = "", children, ...props }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} {...props}>
      {children}
    </div>
  )
}
