export const ERROR_CODES = {
  OK: 0,
  RESOURCE_MISSING: 4004,
  SYSTEM_ERROR: 5000,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function titleForErrorCode(code: number): string {
  if (code === ERROR_CODES.RESOURCE_MISSING) return '资源缺失';
  if (code === ERROR_CODES.SYSTEM_ERROR) return '生成失败';
  return '提示';
}

export function messageForErrorCode(code: number, fallback?: string): string {
  if (code === ERROR_CODES.RESOURCE_MISSING) {
    return '简历中存在缺失/无效的图片资源，已自动跳过并生成 PDF。请检查并重新上传相关图片。';
  }
  if (code === ERROR_CODES.SYSTEM_ERROR) {
    return fallback?.trim() || 'PDF 生成失败，请稍后重试。';
  }
  return fallback?.trim() || '发生未知错误。';
}

