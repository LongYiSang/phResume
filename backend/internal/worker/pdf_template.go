package worker

// PDFTemplateString 是 PDF 渲染的 Go HTML 模板
// 它必须 100% 匹配前端的 CSS Grid 逻辑
const PDFTemplateString = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: '{{.LayoutSettings.FontFamily}}', sans-serif;
            font-size: {{.LayoutSettings.FontSizePt}}pt;
            background: #f0f0f0; /* 仅用于调试 */
        }
        .a4-page {
            width: 794px; /* A4 @ 96 DPI */
            height: 1122px; /* A4 @ 96 DPI */
            background: white;
            margin: 0;
            padding: {{.LayoutSettings.MarginPx}}px;
            box-sizing: border-box; /* 确保 padding 包含在 width/height 内 */

            /* * ----------------------------------------------------
             * !! 关键技术决策 !!
             * 这必须与 react-grid-layout 的配置 100% 匹配
             * ----------------------------------------------------
             */
            display: grid;
            grid-template-columns: repeat(24, 1fr);  /* 24 列 */
            grid-auto-rows: 10px;                   /* 10px 行高 */
            gap: 0; /* 间隙由 RGL 的布局处理 */
        }
	    .grid-item {
	        /* overflow: hidden; */ /* 调试时可以注释掉 */
	        padding: 10px; /* 确保与前端 React Grid Item 的 padding 匹配 */
	    }
        .item-text {
            /* Lexical 输出的 HTML 已经包含了 <p> 等标签 */
            width: 100%;
            color: {{.LayoutSettings.AccentColor}}; /* 示例：应用全局样式 */
        }
        .item-divider {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
        }
        .item-divider hr {
            width: 100%;
            border: 0;
            /* style.thickness 和 style.color 将被内联 */
        }
        .item-image {
            width: 100%;
            height: 100%;
        }
        .item-image img {
            width: 100%;
            height: 100%;
            object-fit: cover; /* 默认值，可以被 style 覆盖 */
        }
    </style>
</head>
<body>
    <div class="a4-page">
        {{range .Items}}
            <!-- 
              为每个 Item 动态计算 CSS Grid 位置
              (注意: CSS Grid 的行/列索引从 1 开始)
            -->
            <div class="grid-item" style="
                grid-column: {{.Layout.X | add 1}} / span {{.Layout.W}};
                grid-row: {{.Layout.Y | add 1}} / span {{.Layout.H}};
            ">
                {{if eq .Type "text"}}
                    <!-- 
                      Go 模板默认会转义 HTML
                      我们必须使用 'safeHTML' 函数来渲染 Lexical 输出的富文本
                    -->
                    <div class="item-text" style="{{.Style | safeCSS}}">
                        {{.Content | safeHTML}}
                    </div>

                {{else if eq .Type "divider"}}
                    <div class="item-divider">
                        <hr style="{{.Style | safeCSS}}" />
                    </div>

                {{else if eq .Type "image"}}
                    <!-- 
                      .Content 在此阶段已被替换为预签名 URL
                    -->
                    <div class="item-image">
                        <img src="{{.Content | safeURL}}" style="{{.Style | safeCSS}}" />
                    </div>
                {{end}}
            </div>
        {{end}}
    </div>
</body>
</html>
`
