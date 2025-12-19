package worker

// 统一的 WebSocket 消息协议（通过 Redis Pub/Sub 转发给前端）。
// 注意：这里的字段名与前端解析保持一致。
type PDFGenerationNotifyMessage struct {
	Status        string   `json:"status"`
	ResumeID      uint     `json:"resume_id"`
	CorrelationID string   `json:"correlation_id"`
	ErrorCode     int      `json:"error_code"`
	ErrorMessage  string   `json:"error_message"`
	MissingKeys   []string `json:"missing_keys,omitempty"`
}
