"use client";

import {
  useMemo,
  useRef,
  useCallback,
  useEffect,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { FORMAT_TEXT_COMMAND } from "lexical";

const DEFAULT_HTML = "<p></p>";

function parseHtmlToNodes(editor: LexicalEditor, html: string): LexicalNode[] {
  const parser = new DOMParser();
  const dom = parser.parseFromString(
    html && html.length > 0 ? html : DEFAULT_HTML,
    "text/html",
  );
  const generatedNodes = $generateNodesFromDOM(editor, dom);
  if (generatedNodes.length === 0) {
    return [$createParagraphNode()];
  }

  return generatedNodes.map((node) => {
    if ($isElementNode(node) || $isDecoratorNode(node)) {
      return node;
    }
    const paragraph = $createParagraphNode();
    paragraph.append(node);
    return paragraph;
  });
}

type TextItemProps = {
  html: string;
  style?: CSSProperties;
  onChange?: (newHtml: string) => void;
  readOnly?: boolean;
};

type ExternalHtmlSyncPluginProps = {
  html: string;
  lastSyncedHtmlRef: MutableRefObject<string>;
};

function ExternalHtmlSyncPlugin({
  html,
  lastSyncedHtmlRef,
}: ExternalHtmlSyncPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (html === lastSyncedHtmlRef.current) {
      return;
    }

    editor.update(() => {
      const nodes = parseHtmlToNodes(editor, html);
      const root = $getRoot();
      root.clear();
      nodes.forEach((node) => root.append(node));
      root.selectEnd();
    });

    lastSyncedHtmlRef.current = html;
  }, [editor, html, lastSyncedHtmlRef]);

  return null;
}

export function TextItem({
  html,
  style,
  onChange,
  readOnly = false,
}: TextItemProps) {
  const baseStyle: CSSProperties = {
    width: "100%",
    minHeight: "100%",
    outline: "none",
    border: "none",
    background: "transparent",
    cursor: readOnly ? "default" : "text",
    whiteSpace: "pre-wrap",
  };

  if (readOnly || !onChange) {
    return (
      <div
        className="text-item-readonly pointer-events-none select-none"
        style={{ ...baseStyle, ...style }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const initialHtmlRef = useRef(html);
  const lastSyncedHtmlRef = useRef(html);

  const initialConfig = useMemo(
    () => ({
      namespace: "text-item-editor",
      editable: true,
      theme: {},
      onError(error: Error) {
        console.error("Lexical error:", error);
        throw error;
      },
      editorState: (editor: LexicalEditor) => {
        const nodes = parseHtmlToNodes(editor, initialHtmlRef.current);
        const root = $getRoot();
        root.clear();
        nodes.forEach((node) => root.append(node));
      },
    }),
    [],
  );

  const handleEditorChange = useCallback(
    (editorState: EditorState, editor: LexicalEditor) => {
      editorState.read(() => {
        const htmlString = $generateHtmlFromNodes(editor);
        if (htmlString === lastSyncedHtmlRef.current) {
          return;
        }
        lastSyncedHtmlRef.current = htmlString;
        onChange(htmlString);
      });
    },
    [onChange],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="h-full w-full">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="text-item-editor"
              style={{ ...baseStyle, ...style }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin onChange={handleEditorChange} />
        <ExternalHtmlSyncPlugin
          html={html}
          lastSyncedHtmlRef={lastSyncedHtmlRef}
        />
      </div>
    </LexicalComposer>
  );
}
// 工具栏移至样式面板侧，模块内部不再渲染工具按钮
