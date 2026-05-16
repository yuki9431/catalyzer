package firestore

import (
	"context"
	"fmt"
)

// ListUserKeys はFirestoreに登録されている全ユーザーキーの一覧を返す。
func ListUserKeys(ctx context.Context) ([]string, error) {
	c := getClient()
	if c == nil {
		return nil, fmt.Errorf("firestore client not initialized")
	}

	docs, err := c.Collection("users").Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}

	keys := make([]string, len(docs))
	for i, doc := range docs {
		keys[i] = doc.Ref.ID
	}
	return keys, nil
}
