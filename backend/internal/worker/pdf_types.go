package worker

// ResumeJSON 是 JSONB 'Content' 字段的 Go 结构
type ResumeJSON struct {
	LayoutSettings LayoutSettings `json:"layout_settings"`
	Items          []Item         `json:"items"`
}

type LayoutSettings struct {
	Columns     int    `json:"columns"`
	RowHeightPx int    `json:"row_height_px"`
	AccentColor string `json:"accent_color"`
	FontFamily  string `json:"font_family"`
	FontSizePt  int    `json:"font_size_pt"`
	MarginPx    int    `json:"margin_px"`
}

type Item struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Content string                 `json:"content"` // Text(HTML), Divider(null), Image(ObjectKey)
	Style   map[string]interface{} `json:"style"`
	Layout  Layout                 `json:"layout"`
}

type Layout struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}
