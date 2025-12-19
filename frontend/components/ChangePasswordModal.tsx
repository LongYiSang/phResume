"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Input } from "@heroui/react";
import { X, Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAuthFetch, friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import type { LoginResponse } from "@/types/api";

type ChangePasswordModalProps = {
  isOpen: boolean;
  canClose?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
};

export function ChangePasswordModal({
  isOpen,
  canClose = true,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [isMounted, setIsMounted] = useState(false);
  const authFetch = useAuthFetch();
  const { setAccessToken, setMustChangePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const validationError = useMemo(() => {
    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      return "请填写所有字段";
    }
    if (newPassword.length < 8) return "新密码至少 8 位";
    if (newPassword !== confirmPassword) return "两次输入的新密码不一致";
    if (newPassword.trim() === currentPassword.trim()) return "新密码不能与当前密码相同";
    return null;
  }, [currentPassword, newPassword, confirmPassword]);

  if (!isMounted || !isOpen) return null;

  const handleClose = () => {
    if (!canClose) return;
    onClose?.();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const { API_ROUTES } = await import("@/lib/api-routes");
      const response = await authFetch(API_ROUTES.AUTH.changePassword(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setError("当前密码不正确");
          return;
        }
        setError(friendlyMessageForStatus(response.status, "default"));
        return;
      }

      const data = (await response.json()) as LoginResponse;
      setAccessToken(data.access_token ?? null);
      setMustChangePassword(Boolean(data.must_change_password));

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess?.();
    } catch (err) {
      console.error("修改密码失败", err);
      setError("修改密码失败，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 backdrop-blur-sm transition-all animate-in fade-in duration-200 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[640px] max-h-[calc(100vh-2rem)] overflow-y-auto bg-white/90 backdrop-blur-xl border border-white/60 rounded-[32px] shadow-card p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-kawaii-purple/10 text-kawaii-purple">
              <ShieldCheck size={20} />
            </div>
            <div className="space-y-0.5">
              <h2 className="text-xl font-bold text-zinc-800">修改密码</h2>
              <p className="text-xs text-zinc-500">更新密码</p>
            </div>
          </div>
          {canClose && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
              aria-label="关闭"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            type="password"
            label="当前密码"
            value={currentPassword}
            onChange={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
            startContent={<Lock size={16} className="text-zinc-400" />}
          />
          <Input
            type="password"
            label="新密码"
            value={newPassword}
            onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
            startContent={<Lock size={16} className="text-zinc-400" />}
          />
          <Input
            type="password"
            label="确认新密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
            startContent={<Lock size={16} className="text-zinc-400" />}
          />

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 border border-red-100">
              {error}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button
              color="primary"
              type="submit"
              isDisabled={Boolean(validationError) || isSubmitting}
              className="rounded-2xl bg-zinc-900 text-white shadow-lg hover:bg-zinc-800 font-medium"
            >
              {isSubmitting ? "提交中..." : "更新密码"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
