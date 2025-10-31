package tasks

import (
	"encoding/json"

	"github.com/hibiken/asynq"
)

// 任务类型常量，确保队列生产者与消费者一致。
const (
	TypePDFGenerate = "pdf:generate"
)

// PDFGeneratePayload 描述生成 PDF 所需的最小信息。
type PDFGeneratePayload struct {
	ResumeID      uint   `json:"resume_id"`
	CorrelationID string `json:"correlation_id"`
}

// NewPDFGenerateTask 构造一个新的简历 PDF 生成任务。
func NewPDFGenerateTask(id uint, correlationID string) (*asynq.Task, error) {
	payload, err := json.Marshal(PDFGeneratePayload{
		ResumeID:      id,
		CorrelationID: correlationID,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TypePDFGenerate, payload), nil
}
