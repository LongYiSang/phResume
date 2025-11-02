package metrics

import (
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
)

var (
	registerOnce sync.Once

	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "phresume",
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "HTTP 请求耗时分布（秒）。",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"method", "path", "status"},
	)

	requestTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "phresume",
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "HTTP 请求总数。",
		},
		[]string{"method", "path", "status"},
	)

	requestsInFlight = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "phresume",
			Subsystem: "http",
			Name:      "in_flight_requests",
			Help:      "当前正在处理的 HTTP 请求数量。",
		},
	)
)

// GinMiddleware 为 Gin 路由注册 Prometheus 指标采集逻辑。
func GinMiddleware() gin.HandlerFunc {
	registerOnce.Do(func() {
		prometheus.MustRegister(requestDuration, requestTotal, requestsInFlight)
	})

	return func(c *gin.Context) {
		start := time.Now()
		requestsInFlight.Inc()
		defer requestsInFlight.Dec()

		c.Next()

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		status := strconv.Itoa(c.Writer.Status())
		labels := prometheus.Labels{
			"method": c.Request.Method,
			"path":   path,
			"status": status,
		}

		requestDuration.With(labels).Observe(time.Since(start).Seconds())
		requestTotal.With(labels).Inc()
	}
}
