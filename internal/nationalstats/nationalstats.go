// Package nationalstats は機体ごとの全国統計（勝率・使用率）の読み書きを扱う。
// 全プレイヤー共通のデータなので、深夜バッチが取得したものをJSONで持ち回る。
package nationalstats

import (
	"encoding/json"
	"os"
	"sort"

	"github.com/yuki9431/catalyzer/internal/model"
)

// Load は全国統計JSONを読み込む。
func Load(path string) (_ []model.MSNationalStat, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		if cerr := f.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	var stats []model.MSNationalStat
	if err := json.NewDecoder(f).Decode(&stats); err != nil {
		return nil, err
	}
	return stats, nil
}

// Save は全国統計JSONを書き出す。
// コスト降順・機体名昇順に固定し、週次更新の差分が値だけに収まるようにする。
func Save(stats []model.MSNationalStat, path string) (err error) {
	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Cost != stats[j].Cost {
			return stats[i].Cost > stats[j].Cost
		}
		return stats[i].Name < stats[j].Name
	})

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(stats)
}
