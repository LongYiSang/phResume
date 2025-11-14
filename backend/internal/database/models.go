package database

import (
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// User 表示系统中的账号信息。
type User struct {
	gorm.Model
	Username     string   `gorm:"uniqueIndex;size:64"`
	PasswordHash string   `gorm:"size:255"`
	Resumes      []Resume `gorm:"constraint:OnDelete:CASCADE"`
}

// Resume 表示用户创建的简历内容。
type Resume struct {
	gorm.Model
	Title   string         `gorm:"size:255"`
	Content datatypes.JSON `gorm:"type:jsonb"`
	UserID  uint           `gorm:"index"`
	User    User           `gorm:"constraint:OnDelete:CASCADE"`
	PdfUrl  string         `gorm:"size:512"`
	Status  string         `gorm:"size:32"`
}

// Template 表示可复用的简历模板。
// 支持私有与公开模板（IsPublic），并归属于创建者（UserID）。
type Template struct {
	gorm.Model
	Title           string         `gorm:"size:255"`
	PreviewImageURL string         `gorm:"size:512"`
	Content         datatypes.JSON `gorm:"type:jsonb"` // JSONB 存储 layout_settings 与 items
	IsPublic        bool           `gorm:"default:false"`
	UserID          uint           `gorm:"index"`
	User            User           `gorm:"constraint:OnDelete:CASCADE"`
}
