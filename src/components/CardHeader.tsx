import type { ReactNode } from "react";

export function CardHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["card-header", className].filter(Boolean).join(" ")}>
      <h2>{title}</h2>
      {actions}
    </div>
  );
}

export function HomeCardHeader({ title, className }: { title: ReactNode; className?: string }) {
  return (
    <div className={["content-card-header", className].filter(Boolean).join(" ")}>
      <h2>{title}</h2>
    </div>
  );
}
