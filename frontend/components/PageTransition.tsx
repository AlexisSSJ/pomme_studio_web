"use client";

import { usePathname } from "next/navigation";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  /**
   * When true, collapses project sub-routes (`/admin/projects/[id]/...` or
   * `/portal/projects/[id]/...`) into a single stable key so the nested
   * ProjectLayout can animate only the right workspace while keeping the
   * ProjectSidebar anchored without flickering.
   */
  preserveProjectShell?: boolean;
}

function getTransitionKey(
  pathname: string,
  preserveProjectShell: boolean
): string {
  if (!preserveProjectShell) return pathname;
  const projectMatch = pathname.match(/^\/(admin|portal)\/projects\/([^/]+)/);
  if (projectMatch) {
    return `/${projectMatch[1]}/projects/${projectMatch[2]}`;
  }
  return pathname;
}

export default function PageTransition({
  children,
  className = "",
  preserveProjectShell = false,
}: PageTransitionProps) {
  const pathname = usePathname() || "";
  const transitionKey = getTransitionKey(pathname, preserveProjectShell);

  return (
    <div
      key={transitionKey}
      className={`animate-page-enter ${className}`.trim()}
    >
      {children}
    </div>
  );
}
