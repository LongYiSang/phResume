"use client";

import { useActiveEditor } from "@/context/ActiveEditorContext";
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Tooltip,
} from "@heroui/react";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_NORMAL,
  ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type TextFormatType,
} from "lexical";
import {
  $createHeadingNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $isListNode } from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List as BulletListIcon,
  ListOrdered,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Key } from "@react-types/shared";
import { toggleListCommand } from "@/utils/lexical";

type BlockType = "paragraph" | HeadingTagType | "bullet" | "number" | "check";
type HeadingOption = "paragraph" | HeadingTagType;

type FormatState = {
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  blockType: BlockType;
  elementFormat: ElementFormatType | null;
};

const DEFAULT_FORMAT_STATE: FormatState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  blockType: "paragraph",
  elementFormat: null,
};

const DEFAULT_HISTORY_STATE = {
  canUndo: false,
  canRedo: false,
};

const headingItems: Array<{ key: HeadingOption; label: string; icon?: ReactNode }> =
  [
    { key: "paragraph", label: "正文" },
    { key: "h1", label: "标题 1", icon: <Heading1 className="h-4 w-4" /> },
    { key: "h2", label: "标题 2", icon: <Heading2 className="h-4 w-4" /> },
    { key: "h3", label: "标题 3", icon: <Heading3 className="h-4 w-4" /> },
  ];

function ToolbarButton({
  isActive,
  isDisabled,
  onPress,
  children,
  "aria-label": ariaLabel,
}: {
  isActive?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Button
      variant={isActive ? "solid" : "light"}
      color={isActive ? "primary" : "default"}
      radius="full"
      isDisabled={isDisabled}
      className="min-w-10"
      onPress={onPress}
      aria-label={ariaLabel}
      isIconOnly
      size="sm"
    >
      {children}
    </Button>
  );
}

export function TopToolbar() {
  const { activeEditor } = useActiveEditor();
  const [formatState, setFormatState] = useState<FormatState>(
    DEFAULT_FORMAT_STATE,
  );
  const [historyState, setHistoryState] = useState(DEFAULT_HISTORY_STATE);

  const updateToolbar = useCallback(() => {
    if (!activeEditor) {
      setFormatState(DEFAULT_FORMAT_STATE);
      return;
    }

    activeEditor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        setFormatState(DEFAULT_FORMAT_STATE);
        return;
      }

      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      if (!$isElementNode(element)) {
        setFormatState(DEFAULT_FORMAT_STATE);
        return;
      }

      let blockType: BlockType = "paragraph";
      if ($isHeadingNode(element)) {
        blockType = element.getTag();
      } else if ($isListNode(element)) {
        blockType = element.getListType() as BlockType;
      }

      setFormatState({
        isBold: selection.hasFormat("bold"),
        isItalic: selection.hasFormat("italic"),
        isUnderline: selection.hasFormat("underline"),
        blockType,
        elementFormat: element.getFormatType(),
      });
    });
  }, [activeEditor]);

  useEffect(() => {
    if (!activeEditor) {
      return;
    }

    updateToolbar();

    const unregister = mergeRegister(
      activeEditor.registerUpdateListener(() => {
        updateToolbar();
      }),
      activeEditor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
      activeEditor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setHistoryState((prev) => ({ ...prev, canUndo: payload }));
          return false;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
      activeEditor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setHistoryState((prev) => ({ ...prev, canRedo: payload }));
          return false;
        },
        COMMAND_PRIORITY_NORMAL,
      ),
    );

    return () => {
      unregister();
    };
  }, [activeEditor, updateToolbar]);

  const headingSelectionKey = useMemo(() => {
    if (
      formatState.blockType === "bullet" ||
      formatState.blockType === "number"
    ) {
      return "paragraph" as HeadingOption;
    }
    return formatState.blockType;
  }, [formatState.blockType]);

  const headingSelectedKeys = useMemo(
    () => new Set<Key>([headingSelectionKey]),
    [headingSelectionKey],
  );

  const applyHeading = useCallback(
    (option: HeadingOption) => {
      if (!activeEditor) {
        return;
      }
      activeEditor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }
        $setBlocksType(selection, () =>
          option === "paragraph"
            ? $createParagraphNode()
            : $createHeadingNode(option),
        );
      });
    },
    [activeEditor],
  );

  const execFormatCommand = useCallback(
    (format: TextFormatType) => {
      if (!activeEditor) return;
      activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
      activeEditor.focus();
    },
    [activeEditor],
  );

  const handleUndo = useCallback(() => {
    if (!activeEditor) return;
    activeEditor.dispatchCommand(UNDO_COMMAND, undefined);
    activeEditor.focus();
  }, [activeEditor]);

  const handleRedo = useCallback(() => {
    if (!activeEditor) return;
    activeEditor.dispatchCommand(REDO_COMMAND, undefined);
    activeEditor.focus();
  }, [activeEditor]);

  const handleListToggle = useCallback(
    (type: "bullet" | "number") => {
      if (!activeEditor) return;
      toggleListCommand(activeEditor, type);
    },
    [activeEditor],
  );

  const handleAlignment = useCallback(
    (format: ElementFormatType) => {
      if (!activeEditor) return;
      activeEditor.dispatchCommand(FORMAT_ELEMENT_COMMAND, format);
      activeEditor.focus();
    },
    [activeEditor],
  );

  const headingLabel = useMemo(() => {
    const current = headingItems.find((item) => item.key === headingSelectionKey);
    if (current) {
      return current.label;
    }
    if (formatState.blockType === "bullet") return "项目符号";
    if (formatState.blockType === "number") return "编号列表";
    if (formatState.blockType === "check") return "复选列表";
    return "正文";
  }, [formatState.blockType, headingSelectionKey]);

  const alignment = formatState.elementFormat ?? ("left" as ElementFormatType);
  const isAlignLeft = alignment === "start" || alignment === "left";
  const isAlignCenter = alignment === "center";
  const isAlignRight = alignment === "end" || alignment === "right";

  return (
    <div
      className="sticky top-4 z-50 flex w-full justify-center"
      data-top-toolbar="true"
      onMouseDownCapture={(event) => {
        if (!activeEditor) return;
        event.preventDefault();
        activeEditor.focus();
      }}
    >
      <div className="max-w-4xl flex-1 px-0">
        <div className="flex items-center gap-3 overflow-x-auto rounded-full border border-white/60 bg-white/80 px-4 py-2 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Tooltip content="撤销">
              <span>
                <ToolbarButton
                  onPress={handleUndo}
                  isDisabled={!activeEditor || !historyState.canUndo}
                  aria-label="撤销"
                >
                  <Undo2 className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="重做">
              <span>
                <ToolbarButton
                  onPress={handleRedo}
                  isDisabled={!activeEditor || !historyState.canRedo}
                  aria-label="重做"
                >
                  <Redo2 className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
          </div>

          <div className="h-6 w-px bg-zinc-200" />

          <Dropdown>
            <DropdownTrigger>
              <Button
                radius="full"
                variant="bordered"
                size="sm"
                className="min-w-28"
                isDisabled={!activeEditor}
              >
                {headingLabel}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="结构"
              selectionMode="single"
              selectedKeys={headingSelectedKeys}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0];
                if (
                  key === "paragraph" ||
                  key === "h1" ||
                  key === "h2" ||
                  key === "h3"
                ) {
                  applyHeading(key);
                }
              }}
            >
              {headingItems.map((item) => (
                <DropdownItem key={item.key} startContent={item.icon}>
                  {item.label}
                </DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>

  <div className="h-6 w-px bg-zinc-200" />

          <div className="flex items-center gap-2">
            <Tooltip content="加粗">
              <span>
                <ToolbarButton
                  isActive={formatState.isBold}
                  isDisabled={!activeEditor}
                  onPress={() => execFormatCommand("bold")}
                  aria-label="加粗"
                >
                  <Bold className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="斜体">
              <span>
                <ToolbarButton
                  isActive={formatState.isItalic}
                  isDisabled={!activeEditor}
                  onPress={() => execFormatCommand("italic")}
                  aria-label="斜体"
                >
                  <Italic className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="下划线">
              <span>
                <ToolbarButton
                  isActive={formatState.isUnderline}
                  isDisabled={!activeEditor}
                  onPress={() => execFormatCommand("underline")}
                  aria-label="下划线"
                >
                  <Underline className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
          </div>

          <div className="h-6 w-px bg-zinc-200" />

          <div className="flex items-center gap-2">
            <Tooltip content="项目符号">
              <span>
                <ToolbarButton
                  isActive={formatState.blockType === "bullet"}
                  isDisabled={!activeEditor}
                  onPress={() => handleListToggle("bullet")}
                  aria-label="项目符号"
                >
                  <BulletListIcon className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="编号列表">
              <span>
                <ToolbarButton
                  isActive={formatState.blockType === "number"}
                  isDisabled={!activeEditor}
                  onPress={() => handleListToggle("number")}
                  aria-label="编号列表"
                >
                  <ListOrdered className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
          </div>

          <div className="h-6 w-px bg-zinc-200" />

          <div className="flex items-center gap-2">
            <Tooltip content="左对齐">
              <span>
                <ToolbarButton
                  isActive={isAlignLeft}
                  isDisabled={!activeEditor}
                  onPress={() => handleAlignment("left")}
                  aria-label="左对齐"
                >
                  <AlignLeft className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="居中对齐">
              <span>
                <ToolbarButton
                  isActive={isAlignCenter}
                  isDisabled={!activeEditor}
                  onPress={() => handleAlignment("center")}
                  aria-label="居中对齐"
                >
                  <AlignCenter className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
            <Tooltip content="右对齐">
              <span>
                <ToolbarButton
                  isActive={isAlignRight}
                  isDisabled={!activeEditor}
                  onPress={() => handleAlignment("right")}
                  aria-label="右对齐"
                >
                  <AlignRight className="h-4 w-4" />
                </ToolbarButton>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
