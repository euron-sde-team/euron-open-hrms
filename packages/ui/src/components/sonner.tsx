"use client"

import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Follow the `.dark` class on <html>, which is how the apps switch themes.
 * A MutationObserver rather than a theme library: the class is the single
 * source of truth, so toasts can never disagree with the page behind them.
 */
function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light")
  useEffect(() => {
    const root = document.documentElement
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light")
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return theme
}

const Toaster = ({ theme, ...props }: ToasterProps) => {
  const documentTheme = useDocumentTheme()

  return (
    <Sonner
      theme={theme ?? documentTheme}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-[18px]" />
        ),
        info: (
          <InfoIcon className="size-[18px]" />
        ),
        warning: (
          <TriangleAlertIcon className="size-[18px]" />
        ),
        error: (
          <OctagonXIcon className="size-[18px]" />
        ),
        loading: (
          <Loader2Icon className="size-[18px] animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "14px",
          "--width": "380px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
