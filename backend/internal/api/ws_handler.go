package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"phResume/internal/auth"
)

// WsHandler 负责处理 WebSocket 鉴权与消息转发。
type WsHandler struct {
	redisClient    *redis.Client
	authService    *auth.AuthService
	logger         *slog.Logger
	upgrader       websocket.Upgrader
	allowedOrigins []string
}

// NewWsHandler 构造 WebSocket 处理器。
func NewWsHandler(redisClient *redis.Client, authService *auth.AuthService, logger *slog.Logger, allowedOrigins []string) *WsHandler {
	h := &WsHandler{
		redisClient:    redisClient,
		authService:    authService,
		logger:         logger,
		allowedOrigins: allowedOrigins,
	}
	h.upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			if len(h.allowedOrigins) == 0 {
				u, err := url.Parse(origin)
				if err != nil {
					return false
				}
				return strings.EqualFold(u.Host, r.Host)
			}
			for _, allowed := range h.allowedOrigins {
				if origin == allowed {
					return true
				}
			}
			return false
		},
	}
	return h
}

type wsAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// HandleConnection 负责升级连接并启动读写循环。
func (h *WsHandler) HandleConnection(c *gin.Context) {
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("upgrade websocket failed", slog.Any("error", err))
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	baseLog := h.logger.With(
		slog.String("client_ip", c.ClientIP()),
	)

	userIDCh := make(chan uint, 1)
	errCh := make(chan error, 1)

	go h.readLoop(ctx, conn, userIDCh, errCh, cancel, baseLog)

	var userID uint
	select {
	case <-ctx.Done():
		return
	case err := <-errCh:
		if err != nil {
			baseLog.Warn("websocket authentication failed", slog.Any("error", err))
		}
		return
	case userID = <-userIDCh:
	}

	userLog := baseLog.With(slog.Uint64("user_id", uint64(userID)))
	go h.subscribeLoop(ctx, conn, userID, errCh, cancel, userLog)

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			userLog.Info("websocket connection closed", slog.Any("error", err))
		} else {
			userLog.Info("websocket connection closed")
		}
	}
}

func (h *WsHandler) readLoop(
	ctx context.Context,
	conn *websocket.Conn,
	userIDCh chan<- uint,
	errCh chan<- error,
	cancel context.CancelFunc,
	log *slog.Logger,
) {
	authenticated := false

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			writeClose(conn, websocket.CloseAbnormalClosure, "read error")
			errCh <- fmt.Errorf("read message: %w", err)
			cancel()
			return
		}

		if !authenticated {
			var authMsg wsAuthMessage
			if err := json.Unmarshal(message, &authMsg); err != nil {
				writeClose(conn, websocket.ClosePolicyViolation, "invalid auth payload")
				errCh <- fmt.Errorf("decode auth payload: %w", err)
				cancel()
				return
			}
			if authMsg.Type != "auth" || authMsg.Token == "" {
				writeClose(conn, websocket.ClosePolicyViolation, "auth required")
				errCh <- fmt.Errorf("invalid auth message")
				cancel()
				return
			}

			claims, err := h.authService.ValidateToken(authMsg.Token)
			if err != nil {
				writeClose(conn, websocket.ClosePolicyViolation, "unauthorized")
				errCh <- fmt.Errorf("validate token: %w", err)
				cancel()
				return
			}
			if claims.TokenType != "access" {
				writeClose(conn, websocket.ClosePolicyViolation, "access token required")
				errCh <- fmt.Errorf("invalid token type: %s", claims.TokenType)
				cancel()
				return
			}
			if claims.MustChangePassword {
				writeClose(conn, websocket.ClosePolicyViolation, "password change required")
				errCh <- fmt.Errorf("password change required")
				cancel()
				return
			}

			authenticated = true
			userIDCh <- claims.UserID
			log.Info("websocket authenticated", slog.Uint64("user_id", uint64(claims.UserID)))
			continue
		}

		// 目前无需处理额外消息，保持循环以检测客户端断开。
	}
}

func writeClose(conn *websocket.Conn, code int, text string) {
	deadline := time.Now().Add(5 * time.Second)
	_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, text), deadline)
}

func (h *WsHandler) subscribeLoop(
	ctx context.Context,
	conn *websocket.Conn,
	userID uint,
	errCh chan<- error,
	cancel context.CancelFunc,
	log *slog.Logger,
) {
	channel := fmt.Sprintf("user_notify:%d", userID)
	pubsub := h.redisClient.Subscribe(ctx, channel)
	defer pubsub.Close()

	log.Info("subscribed to redis channel", slog.String("channel", channel))

	ch := pubsub.Channel()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				errCh <- fmt.Errorf("pubsub channel closed")
				cancel()
				return
			}

			log.Info("forwarding message to client", slog.String("channel", channel))
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
				errCh <- fmt.Errorf("write message: %w", err)
				cancel()
				return
			}
		case <-ticker.C:
			deadline := time.Now().Add(5 * time.Second)
			if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
				errCh <- fmt.Errorf("write ping: %w", err)
				cancel()
				return
			}
		}
	}
}
