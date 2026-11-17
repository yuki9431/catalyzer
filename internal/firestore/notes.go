package firestore

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/yuki9431/catalyzer/internal/model"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	notesCollection = "notes"
	itemsCollection = "items"
	countAlias      = "n"
)

var (
	ErrNoteNotFound = errors.New("note not found")
	ErrNoteLimit    = errors.New("note limit reached")
	ErrPinLimit     = errors.New("pin limit reached")
)

// NoteLimits は件数とピンの上限。判定はトランザクション内で行う。
type NoteLimits struct{ MaxCount, MaxPinned int }

// noteDoc は notes/{userKey}/items/{id} の1ドキュメント。
type noteDoc struct {
	Text      string    `firestore:"text"`
	Enemies   []string  `firestore:"enemies"`
	MyMS      string    `firestore:"my_ms"`
	PartnerMS string    `firestore:"partner_ms"`
	Date      string    `firestore:"date"`
	Pinned    bool      `firestore:"pinned"`
	CreatedAt time.Time `firestore:"created_at"`
	UpdatedAt time.Time `firestore:"updated_at"`
}

func docFromNote(n model.Note) noteDoc {
	return noteDoc{
		Text: n.Text, Enemies: n.Enemies, MyMS: n.MyMS, PartnerMS: n.PartnerMS, Date: n.Date,
		Pinned: n.Pinned, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
	}
}

func (d noteDoc) note(id string) model.Note {
	return model.Note{
		ID: id, Text: d.Text, Enemies: d.Enemies, MyMS: d.MyMS, PartnerMS: d.PartnerMS, Date: d.Date,
		Pinned: d.Pinned, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
}

// checkCreate は追加の可否を判定する。pinnedOthers は既存のピン数。
func checkCreate(count, pinnedOthers int, n model.Note, lim NoteLimits) error {
	if count >= lim.MaxCount {
		return ErrNoteLimit
	}
	if n.Pinned && pinnedOthers >= lim.MaxPinned {
		return ErrPinLimit
	}
	return nil
}

// checkUpdate は更新の可否を判定する。pinnedTotal は自分を含むピン総数、oldPinned は更新前に自分がピンか。
func checkUpdate(pinnedTotal int, oldPinned bool, n model.Note, lim NoteLimits) error {
	if oldPinned {
		pinnedTotal--
	}
	if n.Pinned && pinnedTotal >= lim.MaxPinned {
		return ErrPinLimit
	}
	return nil
}

// notesFromDocs は UpdatedAt の新しい順(同じなら ID 昇順)に並べる。
func notesFromDocs(docs map[string]noteDoc) []model.Note {
	out := make([]model.Note, 0, len(docs))
	for id, d := range docs {
		out = append(out, d.note(id))
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func notesItems(userKey string) (*firestore.CollectionRef, *firestore.Client, error) {
	c := getClient()
	if c == nil {
		return nil, nil, fmt.Errorf("firestore client not initialized")
	}
	return c.Collection(notesCollection).Doc(userKey).Collection(itemsCollection), c, nil
}

// countIn はトランザクション内で q に合致する件数を数える。
func countIn(ctx context.Context, tx *firestore.Transaction, q firestore.Query) (int, error) {
	res, err := q.NewAggregationQuery().WithCount(countAlias).Transaction(tx).Get(ctx)
	if err != nil {
		return 0, fmt.Errorf("count notes: %w", err)
	}
	var m map[string]interface{}
	if err := res.DataTo(&m); err != nil {
		return 0, fmt.Errorf("parse count: %w", err)
	}
	v, ok := m[countAlias].(int64)
	if !ok {
		return 0, fmt.Errorf("parse count: unexpected type %T", m[countAlias])
	}
	return int(v), nil
}

func pinnedQuery(items *firestore.CollectionRef) firestore.Query {
	return items.Where("pinned", "==", true)
}

// ListNotes はユーザーのメモを新しい順に返す。無ければ空。
func ListNotes(ctx context.Context, userKey string) ([]model.Note, error) {
	items, _, err := notesItems(userKey)
	if err != nil {
		return nil, err
	}
	snaps, err := items.Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("get notes: %w", err)
	}
	docs := make(map[string]noteDoc, len(snaps))
	for _, s := range snaps {
		var d noteDoc
		if err := s.DataTo(&d); err != nil {
			return nil, fmt.Errorf("parse note %s/%s: %w", userKey, s.Ref.ID, err)
		}
		docs[s.Ref.ID] = d
	}
	return notesFromDocs(docs), nil
}

// CreateNote はメモを追加する。上限超過は ErrNoteLimit・ErrPinLimit。
func CreateNote(ctx context.Context, userKey string, n model.Note, lim NoteLimits) error {
	items, c, err := notesItems(userKey)
	if err != nil {
		return err
	}
	return c.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		count, err := countIn(ctx, tx, items.Query)
		if err != nil {
			return err
		}
		pinned := 0
		if n.Pinned {
			if pinned, err = countIn(ctx, tx, pinnedQuery(items)); err != nil {
				return err
			}
		}
		if err := checkCreate(count, pinned, n, lim); err != nil {
			return err
		}
		return tx.Create(items.Doc(n.ID), docFromNote(n))
	})
}

// UpdateNote はメモを置き換え、保存済みの CreatedAt を持つ Note を返す。無ければ ErrNoteNotFound。
func UpdateNote(ctx context.Context, userKey string, n model.Note, lim NoteLimits) (model.Note, error) {
	items, c, err := notesItems(userKey)
	if err != nil {
		return model.Note{}, err
	}
	ref := items.Doc(n.ID)
	var out model.Note
	err = c.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, getErr := tx.Get(ref)
		if status.Code(getErr) == codes.NotFound {
			return ErrNoteNotFound
		}
		if getErr != nil {
			return fmt.Errorf("get note: %w", getErr)
		}
		var old noteDoc
		if parseErr := snap.DataTo(&old); parseErr != nil {
			return fmt.Errorf("parse note %s/%s: %w", userKey, n.ID, parseErr)
		}
		pinnedTotal := 0
		if n.Pinned {
			var countErr error
			if pinnedTotal, countErr = countIn(ctx, tx, pinnedQuery(items)); countErr != nil {
				return countErr
			}
		}
		if limErr := checkUpdate(pinnedTotal, old.Pinned, n, lim); limErr != nil {
			return limErr
		}
		n.CreatedAt = old.CreatedAt
		out = n
		return tx.Set(ref, docFromNote(n))
	})
	if err != nil {
		return model.Note{}, err
	}
	return out, nil
}

// DeleteNote はメモを削除する。無ければ ErrNoteNotFound。
func DeleteNote(ctx context.Context, userKey, id string) error {
	items, c, err := notesItems(userKey)
	if err != nil {
		return err
	}
	ref := items.Doc(id)
	return c.RunTransaction(ctx, func(_ context.Context, tx *firestore.Transaction) error {
		if _, err := tx.Get(ref); status.Code(err) == codes.NotFound {
			return ErrNoteNotFound
		} else if err != nil {
			return fmt.Errorf("get note: %w", err)
		}
		return tx.Delete(ref)
	})
}
