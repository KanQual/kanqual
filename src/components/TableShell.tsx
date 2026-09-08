import type { ComponentPropsWithoutRef, ReactNode } from "react";

type TableShellProps = ComponentPropsWithoutRef<"div">;

export function TableShell({ className, children, ...props }: TableShellProps) {
  return (
    <div className={["data-table-wrap", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

export function TableMessageRow({
  children,
  colSpan,
  className,
}: {
  children: ReactNode;
  colSpan: number;
  className?: string;
}) {
  return (
    <tr>
      <td className={["data-table-message", className].filter(Boolean).join(" ")} colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}
