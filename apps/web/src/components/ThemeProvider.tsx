"use client";

/**
 * ThemeProvider — reads the persisted theme from desktopStore and applies
 * `data-theme="dark"|"light"` to <html>, enabling CSS variable overrides in
 * globals.css. Also applies the system-preferred theme on first paint before
 * hydration to avoid a flash of the wrong theme.
 */

import { useEffect } from "react";
import { useDesktopStore } from "@/stores/desktopStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useDesktopStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <>{children}</>;
}
