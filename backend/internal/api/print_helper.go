package api

import (
	"errors"
)

type inlineImageError struct {
	status int
	msg    string
}

func (e *inlineImageError) Error() string {
	return e.msg
}

func statusFromInlineError(err error) (int, bool) {
	var inlineErr *inlineImageError
	if errors.As(err, &inlineErr) {
		return inlineErr.status, true
	}
	return 0, false
}
