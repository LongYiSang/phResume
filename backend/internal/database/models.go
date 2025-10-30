package database

import "gorm.io/gorm"

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
	Title   string `gorm:"size:255"`
	Content string `gorm:"type:text"`
	UserID  uint   `gorm:"index"`
	User    User   `gorm:"constraint:OnDelete:CASCADE"`
}
