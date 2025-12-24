"use client";

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";

type RateLimitModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  message?: string | null;
  error?: string | null;
  errorLocation?: string;
  frameworkVersion?: string;
  title?: string;
};

const DEFAULT_ERROR_LOCATION = "handleDownload (hooks/usePdfDownload.ts)";
const DEFAULT_FRAMEWORK_VERSION = "Next.js 16.0.1 (Turbopack)";

export function RateLimitModal({
  isOpen,
  onOpenChange,
  message,
  error,
  errorLocation = DEFAULT_ERROR_LOCATION,
  frameworkVersion = DEFAULT_FRAMEWORK_VERSION,
  title = "生成次数上限",
}: RateLimitModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody>
              <div className="space-y-2">
                <div className="text-sm text-kawaii-text">
                  {message ?? "生成过于频繁，请稍后再试"}
                </div>
                <div className="text-xs text-slate-500">错误类型：Console Error</div>
                <div className="text-xs text-slate-500">
                  错误信息：{error ?? "下载失败"}
                </div>
                <div className="text-xs text-slate-500">错误位置：{errorLocation}</div>
                <div className="text-xs text-slate-500">Next.js 版本：{frameworkVersion}</div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button color="primary" onPress={onClose}>
                知道了
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
