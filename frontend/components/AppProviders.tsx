"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/context/AuthContext";
import Providers from "@/app/providers";
import { ChangePasswordGate } from "@/components/ChangePasswordGate";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isPrintRoute =
    pathname.startsWith("/print") || pathname.startsWith("/print-template");

  if (isPrintRoute) {
    return <Providers>{children}</Providers>;
  }

  return (
    <AuthProvider>
      <Providers>
        {children}
        <ChangePasswordGate />
      </Providers>
    </AuthProvider>
  );
}

