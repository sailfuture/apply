"use client"

import { useEffect, useId, useMemo, useRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-6 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "group/field flex w-full gap-3 data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

/**
 * The controls a field's label can name through `for`. Each is a
 * "labelable" element, so the browser also sends a click on the label
 * to it. File inputs are left out on purpose: a click on the label
 * would open the file picker, and the uploader names its own input.
 */
const FIELD_CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"])',
  "textarea",
  "select",
  'button[role="combobox"]',
  'button[role="checkbox"]',
  'button[role="switch"]',
].join(", ")

/**
 * Give a field's control its label.
 *
 * A `<FieldLabel>` and an `<Input>` sitting side by side in a `<Field>`
 * are not connected by anything a browser or a screen reader can see:
 * the input was announced as "edit text" with only its placeholder to
 * go on, and clicking the label did nothing. Almost every form in the
 * app is written that way, so the field connects them itself: its own
 * label gets `for`, pointing at its own first control (which is given
 * an id when it has none).
 *
 * Done on the DOM after render because the label and the control are
 * separate components that know nothing of each other, and a control
 * can be any of several (input, textarea, select trigger, checkbox,
 * switch). Left alone when the page already set `for`, when the label
 * wraps its control (a choice card), and for nested fields, which wire
 * themselves.
 */
function useFieldLabelWiring(rootRef: React.RefObject<HTMLDivElement | null>) {
  const autoId = useId()
  // No dependency list: the control inside a field can be swapped by a
  // render this component never sees (a select replaced by an input).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const own = (el: Element) => el.closest('[data-slot="field"]') === root
    const label = Array.from(
      root.querySelectorAll<HTMLLabelElement>('label[data-slot="field-label"]')
    ).find(own)
    if (!label) return
    const wiredByField = label.dataset.fieldWired === "true"
    if (label.hasAttribute("for") && !wiredByField) return
    const control = Array.from(
      root.querySelectorAll<HTMLElement>(FIELD_CONTROL_SELECTOR)
    ).find((el) => own(el) && !label.contains(el))
    if (!control || label.querySelector(FIELD_CONTROL_SELECTOR)) {
      if (wiredByField) {
        label.removeAttribute("for")
        delete label.dataset.fieldWired
      }
      return
    }
    if (!control.id) control.id = `${autoId}-control`
    if (label.htmlFor !== control.id) {
      label.htmlFor = control.id
      label.dataset.fieldWired = "true"
    }
  })
}

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  const rootRef = useRef<HTMLDivElement>(null)
  useFieldLabelWiring(rootRef)
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
      // After `props`: the wiring above needs this element. Nothing in
      // the app passes a ref to a field.
      ref={rootRef}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "group/field-content flex flex-1 flex-col gap-1 leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border *:data-[slot=field]:p-3 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2 text-sm leading-snug font-medium group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
        "last:mt-0 nth-last-2:-mt-1",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
