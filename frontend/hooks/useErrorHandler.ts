import { useState, useCallback } from 'react';
import { useAlertModal } from '@/context/AlertModalContext';

export function useErrorHandler() {
  const { showAlert } = useAlertModal();
  const [error, setError] = useState<string | null>(null);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const showRateLimitModal = useCallback((message: string, error: string) => {
    setRateLimitMessage(message);
    setRateLimitError(error);
    setIsRateLimitModalOpen(true);
    setError(null);
  }, []);

  const handleError = useCallback((err: unknown, context?: string) => {
    console.error(`Error${context ? ` in ${context}` : ''}:`, err);
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  return {
    error,
    setError,
    clearError,
    isRateLimitModalOpen,
    setIsRateLimitModalOpen,
    rateLimitMessage,
    rateLimitError,
    showRateLimitModal,
    handleError,
  };
}
