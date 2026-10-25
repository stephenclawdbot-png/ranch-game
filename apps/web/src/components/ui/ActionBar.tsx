import type { ReactNode } from "react";

/**
 * The screen's one primary action. On phones it is a sticky bar in the thumb zone, directly
 * above the tab bar; on desktop it renders inline where it is placed. Put exactly one
 * `.btn.btn-brass` inside.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`action-bar ${className ?? ""}`} data-action-bar>
      {children}
    </div>
  );
}
