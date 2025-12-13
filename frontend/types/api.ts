import type { ResumeData } from "@/types/resume";

export interface ApiResponse<T = unknown> {
  message?: string;
  data?: T;
  error?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  must_change_password?: boolean;
}

export type RefreshResponse = LoginResponse;

export type LogoutResponse = Record<string, never>;

export interface ResumeSummary {
  id: number;
  title: string;
  preview_image_url?: string;
  created_at: string;
}

export interface Resume extends ResumeSummary {
  content: ResumeData;
  updated_at: string;
}

export type ResumeListResponse = ResumeSummary[];

export interface ResumeDownloadAccepted {
  message: string;
  task_id: string;
}

export interface ResumeDownloadLink {
  url: string;
}

export interface AssetItem {
  objectKey: string;
  previewUrl: string;
  size: number;
  lastModified: string;
}

export interface AssetListResponse {
  items: AssetItem[];
}

export interface AssetUploadResponse {
  objectKey: string;
}

export interface AssetViewResponse {
  url: string;
}

export interface TemplateSummary {
  id: number;
  title: string;
  preview_image_url?: string;
  is_owner?: boolean;
}

export interface Template {
  id: number;
  title: string;
  content: ResumeData;
  preview_image_url?: string;
}

export type TemplateListResponse = TemplateSummary[];

export interface TemplatePreviewAccepted {
  message: string;
  task_id: string;
}

export interface WsAuthMessage {
  type: "auth";
  token: string;
}

export type WsEvent = {
  event: "pdf_ready";
  resume_id: number;
  url: string;
};
