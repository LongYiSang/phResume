package errcode

// 错误码约定：
// - 0：无错误
// - 4xxx：业务可恢复/告警类错误（例如资源缺失但流程可继续）
// - 5xxx：系统错误（需要中断流程）
const (
	OK              = 0
	ResourceMissing = 4004
	SystemError     = 5000
)
