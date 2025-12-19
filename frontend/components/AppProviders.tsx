"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/context/AuthContext";
import Providers from "@/app/providers";
import { ChangePasswordGate } from "@/components/ChangePasswordGate";
import { AlertModalProvider } from "@/context/AlertModalContext";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const isPrintRoute =
    pathname.startsWith("/print") || pathname.startsWith("/print-template");

  if (isPrintRoute) {
    return (
      <AlertModalProvider>
        <Providers>{children}</Providers>
      </AlertModalProvider>
    );
  }

  return (
    <AuthProvider>
      <AlertModalProvider>
        <Providers>
          {children}
          <ChangePasswordGate />
        </Providers>
      </AlertModalProvider>
    </AuthProvider>
  );
}
