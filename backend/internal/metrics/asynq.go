package metrics

import (
	"context"

	"github.com/hibiken/asynq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	taskProcessedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "phresume",
			Subsystem: "asynq",
			Name:      "tasks_processed_total",
			Help:      "任务处理总数。",
		},
		[]string{"task_type"},
	)

	taskFailedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "phresume",
			Subsystem: "asynq",
			Name:      "tasks_failed_total",
			Help:      "任务处理失败总数。",
		},
		[]string{"task_type"},
	)

	taskInProgress = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "phresume",
			Subsystem: "asynq",
			Name:      "tasks_in_progress",
			Help:      "当前正在处理的任务数量。",
		},
		[]string{"task_type"},
	)
)

// AsynqMetricsMiddleware 记录 Asynq 任务处理指标。
func AsynqMetricsMiddleware() asynq.MiddlewareFunc {
	return func(next asynq.Handler) asynq.Handler {
		return asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
			taskType := task.Type()
			taskInProgress.WithLabelValues(taskType).Inc()
			defer taskInProgress.WithLabelValues(taskType).Dec()

			err := next.ProcessTask(ctx, task)
			if err != nil {
				taskFailedTotal.WithLabelValues(taskType).Inc()
			}

			taskProcessedTotal.WithLabelValues(taskType).Inc()

			return err
		})
	}
}
