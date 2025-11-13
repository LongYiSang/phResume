package resume

// Content 表示存储在简历 Content(JSONB) 中的结构化数据。
type Content struct {
	LayoutSettings LayoutSettings `json:"layout_settings"`
	Items          []Item         `json:"items"`
}

// LayoutSettings 描述页面的全局样式。
type LayoutSettings struct {
	Columns     int    `json:"columns"`
	RowHeightPx int    `json:"row_height_px"`
	AccentColor string `json:"accent_color"`
	FontFamily  string `json:"font_family"`
	FontSizePt  int    `json:"font_size_pt"`
	MarginPx    int    `json:"margin_px"`
}

// Item 表示页面中的单个元素。
type Item struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Content string                 `json:"content"`
	Style   map[string]interface{} `json:"style"`
	Layout  Layout                 `json:"layout"`
}

// Layout 描述元素在网格中的位置、宽高。
type Layout struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}
