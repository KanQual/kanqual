import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type TableShellProps = ComponentPropsWithoutRef<"div">;

export const TableShell = forwardRef<HTMLDivElement, TableShellProps>(function TableShell({ className, children, ...props }, ref) {
  return (
    <div ref={ref} className={["data-table-wrap", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
});

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
