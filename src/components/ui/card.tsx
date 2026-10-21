import { cn } from "@/src/lib/utils";
export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-2xl border border-border bg-card p-6 card-shadow", className)}
      {...props}
    />
  );
}
