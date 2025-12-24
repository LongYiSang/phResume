"use client";

import { useCallback, useState, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { v4 as uuidv4 } from "uuid";
import { useRefState } from "@/hooks/useRefState";
import { friendlyMessageForStatus } from "@/hooks/useAuthFetch";
import { API_ROUTES } from "@/lib/api-routes";
import { DEFAULT_LAYOUT_SETTINGS, normalizeResumeContent } from "@/utils/resume";
import {
  calcOverlapIds,
  computeCenteredPosition,
} from "@/utils/resumeItemUtils";
import type { LayoutSettings, ResumeData, ResumeItem } from "@/types/resume";

type ShowAlert = (payload: { title?: string; message: string }) => void;

type UseResumeActionsParams = {
  isAuthenticated: boolean;
  authFetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;
  resumeData: ResumeData | null;
  resumeDataRef: MutableRefObject<ResumeData | null>;
  withHistory: (updater: (prev: ResumeData) => ResumeData) => void;
  resetEditorState: (nextData: ResumeData | null) => void;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  showAlert: ShowAlert;
  onResumeApplied?: () => void;
  onAssetUploaded?: () => void;
};

export function useResumeActions({
  isAuthenticated,
  authFetch,
  resumeData,
  resumeDataRef,
  withHistory,
  resetEditorState,
  setSelectedItemId,
  setError,
  showAlert,
  onResumeApplied,
  onAssetUploaded,
}: UseResumeActionsParams) {
  const [title, setTitle] = useState("");
  const [savedResumeId, setSavedResumeId, savedResumeIdRef] = useRefState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);

  const applyServerResume = useCallback(
    (payload: { id: number | null; title: string; content: ResumeData | null }) => {
      setTitle(payload.title);
      setSavedResumeId(payload.id);
      resetEditorState(payload.content);
    },
    [resetEditorState, setSavedResumeId],
  );

  const fetchLatestResume = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsFetchingResume(true);
    setError(null);

    try {
      const response = await authFetch(API_ROUTES.RESUME.latest());

      if (!response.ok) {
        throw new Error("failed to fetch latest resume");
      }

      const data = await response.json();
      const parsedContent = normalizeResumeContent(data?.content);
      applyServerResume({
        id: typeof data?.id === "number" && data.id > 0 ? data.id : null,
        title: data?.title ?? "",
        content: parsedContent,
      });
    } catch (err) {
      console.error("加载最新简历失败", err);
      setError("加载最新简历失败，请稍后重试");
    } finally {
      setIsFetchingResume(false);
    }
  }, [applyServerResume, authFetch, isAuthenticated, setError]);

  const handleSave = useCallback(async () => {
    setError(null);

    if (!isAuthenticated) {
      setError("请先登录");
      return;
    }

    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    const currentOverlap = calcOverlapIds(resumeData.items);
    if (currentOverlap.size > 0) {
      setError("存在重叠模块，无法保存，请调整位置后重试。");
      return;
    }

    let targetTitle = title.trim();
    let endpoint = "";
    let method: "POST" | "PUT" = "POST";
    const resumeIdForUpdate: number | null = savedResumeId;

    if (resumeIdForUpdate === null) {
      const inputTitle = window.prompt("请输入新简历标题", title || "我的简历");
      if (inputTitle === null) {
        return;
      }
      targetTitle = inputTitle.trim();
      if (!targetTitle) {
        setError("简历标题不能为空");
        return;
      }
      endpoint = API_ROUTES.RESUME.create();
      method = "POST";
    } else {
      if (!targetTitle) {
        setError("简历标题不能为空");
        return;
      }
      endpoint = API_ROUTES.RESUME.update(resumeIdForUpdate);
      method = "PUT";
    }

    setIsLoading(true);

    try {
      const response = await authFetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: targetTitle, content: resumeData }),
      });

      if (!response.ok) {
        if (response.status === 403 && resumeIdForUpdate === null) {
          setError("已达简历保存上限，请升级会员。");
          return;
        }
        throw new Error("保存失败");
      }

      const data = await response.json();
      const normalized = normalizeResumeContent(data?.content);
      const nextId =
        typeof data?.id === "number" && data.id > 0
          ? data.id
          : resumeIdForUpdate;
      applyServerResume({
        id: typeof nextId === "number" ? nextId : null,
        title: data?.title ?? targetTitle,
        content: normalized ?? resumeDataRef.current ?? null,
      });
      onResumeApplied?.();
    } catch (err) {
      console.error("保存失败", err);
      setError("保存失败，请重试");
    } finally {
      setIsLoading(false);
    }
  }, [
    applyServerResume,
    authFetch,
    isAuthenticated,
    onResumeApplied,
    resumeData,
    resumeDataRef,
    savedResumeId,
    setError,
    title,
  ]);

  const appendImageItem = useCallback(
    (objectKey: string) => {
      withHistory((prev) => {
        const newImage: ResumeItem = {
          id: uuidv4(),
          type: "image",
          content: objectKey,
          layout: { x: 0, y: 0, w: 6, h: 10 },
          style: {
            borderRadius: "0.375rem",
            objectFit: "cover",
          },
        };
        return { ...prev, items: [...prev.items, newImage] };
      });
    },
    [withHistory],
  );

  const handleAddSectionTitle = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    const defaultW = 24;
    const defaultH = 3;
    const accentColor =
      resumeData.layout_settings?.accent_color ??
      DEFAULT_LAYOUT_SETTINGS.accent_color;

    withHistory((prev) => {
      const pos = computeCenteredPosition(prev, defaultW, defaultH);
      const newItem: ResumeItem = {
        id: uuidv4(),
        type: "section_title",
        content: "分节标题",
        layout: { x: pos.x, y: pos.y, w: defaultW, h: defaultH },
        style: {
          fontSize: `${(prev.layout_settings?.font_size_pt ?? DEFAULT_LAYOUT_SETTINGS.font_size_pt) + 2}pt`,
          backgroundColor: accentColor,
          color: "#ffffff",
          borderColor: accentColor,
        },
      };
      return { ...prev, items: [...prev.items, newItem] };
    });
  }, [resumeData, setError, withHistory]);

  const handleAddText = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }
    const defaultW = 12;
    const defaultH = 6;
    withHistory((prev) => {
      const pos = computeCenteredPosition(prev, defaultW, defaultH);
      const newText: ResumeItem = {
        id: uuidv4(),
        type: "text",
        content: "",
        layout: { x: pos.x, y: pos.y, w: defaultW, h: defaultH },
        style: {
          fontSize: `${prev.layout_settings?.font_size_pt ?? DEFAULT_LAYOUT_SETTINGS.font_size_pt}pt`,
          color: prev.layout_settings?.accent_color ?? DEFAULT_LAYOUT_SETTINGS.accent_color,
        },
      };
      return { ...prev, items: [...prev.items, newText] };
    });
  }, [resumeData, setError, withHistory]);

  const handleAddDivider = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return;
    }

    const accentColor =
      resumeData.layout_settings?.accent_color ??
      DEFAULT_LAYOUT_SETTINGS.accent_color;

    withHistory((prev) => {
      const newDivider: ResumeItem = {
        id: uuidv4(),
        type: "divider",
        content: "",
        layout: { x: 0, y: 0, w: 24, h: 2 },
        style: {
          borderTop: `2px solid ${accentColor}`,
          margin: "8px 0",
        },
      };
      return { ...prev, items: [...prev.items, newDivider] };
    });
  }, [resumeData, setError, withHistory]);

  const handleAddImageClick = useCallback(() => {
    if (!resumeData) {
      setError("简历内容尚未加载完成");
      return false;
    }
    if (!isAuthenticated) {
      setError("请先登录");
      return false;
    }
    return true;
  }, [isAuthenticated, resumeData, setError]);

  const handleImageUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      if (!isAuthenticated) {
        setError("请先登录");
        event.target.value = "";
        return;
      }

      if (!resumeDataRef.current) {
        setError("简历内容尚未加载完成");
        event.target.value = "";
        return;
      }

      setError(null);
      setIsUploadingAsset(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await authFetch(API_ROUTES.ASSETS.upload(), {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          if (process.env.NODE_ENV !== "production") {
            console.error("图片上传失败", {
              status: response.status,
            });
          }
          if (response.status === 403) {
            showAlert({
              title: "上传上限",
              message: `您已达到最大上传数量限制（${4}张），请一段时间后再尝试上传`,
            });
            setError(null);
            throw new Error("asset limit reached");
          }
          setError(friendlyMessageForStatus(response.status, "upload"));
          throw new Error("upload failed");
        }

        const data = await response.json();
        const objectKey = data?.objectKey;

        if (typeof objectKey !== "string" || objectKey.length === 0) {
          throw new Error("missing object key");
        }

        appendImageItem(objectKey);
        onAssetUploaded?.();
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.error("图片上传失败", err);
        }
        if (String((err as Error | undefined)?.message ?? "") !== "asset limit reached") {
          setError((prev) => prev ?? "图片上传失败，请重试");
        }
      } finally {
        setIsUploadingAsset(false);
        event.target.value = "";
      }
    },
    [appendImageItem, authFetch, isAuthenticated, onAssetUploaded, resumeDataRef, setError, showAlert],
  );

  const handleSelectAssetFromPanel = useCallback(
    (objectKey: string) => {
      if (!isAuthenticated) {
        setError("请先登录");
        return false;
      }
      if (!resumeDataRef.current) {
        setError("简历内容尚未加载完成");
        return false;
      }
      appendImageItem(objectKey);
      return true;
    },
    [appendImageItem, isAuthenticated, resumeDataRef, setError],
  );

  const handleSelectItem = useCallback(
    (itemId: string) => {
      setSelectedItemId(itemId);
    },
    [setSelectedItemId],
  );

  const handlePanelResumeSelected = useCallback(
    (payload: { id: number; title: string; content: ResumeData }) => {
      applyServerResume({
        id: payload.id,
        title: payload.title,
        content: payload.content,
      });
      onResumeApplied?.();
    },
    [applyServerResume, onResumeApplied],
  );

  const handlePanelResumeDeleted = useCallback(
    (deletedId: number) => {
      if (savedResumeId === deletedId) {
        fetchLatestResume();
      }
    },
    [fetchLatestResume, savedResumeId],
  );

  const saveResume = useCallback(
    async (items: ResumeItem[], newSettings: LayoutSettings) => {
      if (!isAuthenticated) {
        return;
      }
      if (!savedResumeId) {
        return;
      }
      try {
        await authFetch(API_ROUTES.RESUME.update(savedResumeId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content: {
              layout_settings: newSettings,
              items,
            },
          }),
        });
      } catch (err) {
        console.error("自动保存失败", err);
      }
    },
    [authFetch, isAuthenticated, savedResumeId, title],
  );

  return {
    title,
    setTitle,
    savedResumeId,
    savedResumeIdRef,
    isLoading,
    isFetchingResume,
    isUploadingAsset,
    fetchLatestResume,
    handleSave,
    applyServerResume,
    handleAddText,
    handleAddSectionTitle,
    handleAddDivider,
    handleAddImageClick,
    handleImageUpload,
    handleSelectAssetFromPanel,
    handleSelectItem,
    handlePanelResumeSelected,
    handlePanelResumeDeleted,
    saveResume,
  };
}
