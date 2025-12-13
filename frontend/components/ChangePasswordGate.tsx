"use client";

import { useAuth } from "@/context/AuthContext";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";

export function ChangePasswordGate() {
  const { isAuthenticated, isCheckingAuth, mustChangePassword, setMustChangePassword } = useAuth();
  const isOpen = Boolean(!isCheckingAuth && isAuthenticated && mustChangePassword);

  if (!isOpen) return null;

  return (
    <ChangePasswordModal
      isOpen={isOpen}
      canClose={false}
      onSuccess={() => {
        setMustChangePassword(false);
      }}
    />
  );
}
