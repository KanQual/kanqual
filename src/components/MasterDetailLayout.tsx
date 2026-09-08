import type { ComponentPropsWithoutRef } from "react";

type MasterDetailLayoutProps = ComponentPropsWithoutRef<"div">;

export function MasterDetailLayout({ className, children, style, ...props }: MasterDetailLayoutProps) {
  return (
    <div
      className={["master-detail-grid", className].filter(Boolean).join(" ")}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 340px) auto minmax(0, 1fr)",
        gap: 0,
        alignItems: "stretch",
        flex: "0 0 auto",
        minHeight: 0,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
