import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";
export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 active:scale-[.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--color-primary-hover)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[var(--color-border)]",
        accent: "bg-accent text-accent-foreground hover:brightness-95",
        outline: "border border-border bg-card text-foreground hover:bg-secondary",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-primary",
        destructive: "bg-destructive text-white hover:opacity-90",
      },
      size: { default: "", sm: "px-4 py-2", icon: "h-11 w-11 p-0", lg: "min-h-13 px-6 text-base" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
