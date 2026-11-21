// src/components/ui/alert-dialog.jsx
import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const AlertDialogContext = React.createContext({
  open: false,
  setOpen: () => {},
})

export function AlertDialog({ open: controlledOpen, onOpenChange, children }) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = React.useCallback(
    (value) => {
      if (!isControlled) {
        setUncontrolledOpen(value)
      }
      onOpenChange?.(value)
    },
    [isControlled, onOpenChange]
  )

  return (
    <AlertDialogContext.Provider value={{ open, setOpen }}>
      {children}
    </AlertDialogContext.Provider>
  )
}

export function AlertDialogTrigger({ render, children, asChild, ...props }) {
  const { setOpen } = React.useContext(AlertDialogContext)
  const handleClick = (e) => {
    props.onClick?.(e)
    setOpen(true)
  }

  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      onClick: handleClick,
      ...props,
    })
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: handleClick,
      ...props,
    })
  }

  return (
    <Button variant="outline" type="button" onClick={handleClick} {...props}>
      {children}
    </Button>
  )
}

export function AlertDialogContent({ className = "", children, ...props }) {
  const { open, setOpen } = React.useContext(AlertDialogContext)

  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && open) setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className={cn(
          "relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export function AlertDialogHeader({ className = "", ...props }) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
}

export function AlertDialogTitle({ className = "", ...props }) {
  return <h2 className={cn("text-lg font-bold text-slate-900", className)} {...props} />
}

export function AlertDialogDescription({ className = "", ...props }) {
  return <p className={cn("text-xs sm:text-sm text-muted-foreground leading-relaxed", className)} {...props} />
}

export function AlertDialogFooter({ className = "", ...props }) {
  return <div className={cn("flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 mt-1", className)} {...props} />
}

export function AlertDialogCancel({ render, children = "No", asChild, onClick, ...props }) {
  const { setOpen } = React.useContext(AlertDialogContext)

  const handleClick = (e) => {
    onClick?.(e)
    setOpen(false)
  }

  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      onClick: handleClick,
      ...props,
    })
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: handleClick,
      ...props,
    })
  }

  return (
    <Button variant="outline" type="button" onClick={handleClick} {...props}>
      {children}
    </Button>
  )
}

export function AlertDialogAction({ render, children = "Yes", asChild, onClick, ...props }) {
  const { setOpen } = React.useContext(AlertDialogContext)

  const handleClick = (e) => {
    onClick?.(e)
    setOpen(false)
  }

  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, {
      onClick: handleClick,
      ...props,
    })
  }

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onClick: handleClick,
      ...props,
    })
  }

  return (
    <Button variant="default" type="button" onClick={handleClick} {...props}>
      {children}
    </Button>
  )
}
