import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"

/**
 * How long a toast stays when its caller did not say. A confirmation is read
 * at a glance. A failure carries a sentence the user needs, and three seconds
 * was gone before the second line was read. A toast with an action stays
 * longest, and Radix holds its timer while it is hovered or focused, so the
 * answer is not taken away mid-reach; but it still leaves, because one that
 * never does sits on whatever controls are under it. A notice that truly must
 * stay passes `duration: Infinity` itself.
 */
function defaultDuration(variant: unknown, action: unknown): number {
  if (action) return 10000
  return variant === "destructive" ? 8000 : 3000
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={3000}>
      {/* `pinned` is store policy, not a Radix prop — the rest of props is
          spread onto the DOM node, and React warns on an unknown attribute. */}
      {toasts.map(function ({ id, title, description, action, pinned: _pinned, ...props }) {
        return (
          <Toast
            key={id}
            {...props}
            duration={
              typeof props.duration === "number"
                ? props.duration
                : defaultDuration(props.variant, action)
            }
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
