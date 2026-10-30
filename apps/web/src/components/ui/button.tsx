import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Sizes follow the NeedGrid designs: 44 px tap targets by default, 8 px control radius. `sm` is 40 px
// only with a mouse on a wide screen; phones and touch screens get the full 44 px.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-bold whitespace-nowrap no-underline transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground",
        outline:
          "border-border-strong bg-surface text-foreground hover:bg-placeholder hover:text-foreground aria-expanded:bg-placeholder",
        secondary: "border-primary bg-surface text-primary hover:bg-primary-soft hover:text-primary",
        ghost: "text-foreground hover:bg-placeholder hover:text-foreground aria-expanded:bg-placeholder",
        destructive: "bg-danger text-primary-foreground hover:bg-danger/90 hover:text-primary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 gap-2 px-4",
        sm: "h-10 gap-1.5 px-3.5 text-[13px] max-md:h-11 pointer-coarse:h-11",
        lg: "h-13 gap-2 px-5.5 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
