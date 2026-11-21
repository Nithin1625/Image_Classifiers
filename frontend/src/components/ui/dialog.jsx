// src/components/ui/dialog.jsx
import * as React from "react"
import { X } from "lucide-react"

const DialogContext = React.createContext({
  open: false,
  setOpen: () => {},
})

export function Dialog({ open: controlledOpen, onOpenChange, children }) {
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
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

export function DialogTrigger({ render, children, asChild, ...props }) {
  const { setOpen } = React.useContext(DialogContext)
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
    <button type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  )
}

export function DialogContent({ className = "", children, ...props }) {
  const { open, setOpen } = React.useContext(DialogContext)

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
        className={`relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200 ${className}`}
        {...props}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className = "", ...props }) {
  return <div className={`flex flex-col gap-1.5 text-left ${className}`} {...props} />
}

export function DialogTitle({ className = "", ...props }) {
  return <h2 className={`text-lg font-bold text-slate-900 ${className}`} {...props} />
}

export function DialogDescription({ className = "", ...props }) {
  return <p className={`text-xs text-muted-foreground ${className}`} {...props} />
}

export function DialogFooter({ className = "", ...props }) {
  return <div className={`flex items-center justify-end gap-2.5 pt-2 ${className}`} {...props} />
}

export function DialogClose({ render, children, asChild, ...props }) {
  const { setOpen } = React.useContext(DialogContext)
  const handleClick = (e) => {
    props.onClick?.(e)
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
    <button type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  )
}
