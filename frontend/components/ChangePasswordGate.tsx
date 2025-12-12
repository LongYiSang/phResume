"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";

export function ChangePasswordGate() {
  const { isAuthenticated, isCheckingAuth, mustChangePassword, setMustChangePassword } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isCheckingAuth) return;
    setIsOpen(Boolean(isAuthenticated && mustChangePassword));
  }, [isAuthenticated, isCheckingAuth, mustChangePassword]);

  if (!isOpen) return null;

  return (
    <ChangePasswordModal
      isOpen
      canClose={false}
      onSuccess={() => {
        setMustChangePassword(false);
        setIsOpen(false);
      }}
    />
  );
}

