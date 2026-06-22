#!/usr/bin/env python3
"""ローカル開発・動作確認用のダミー試合データを生成する。

公式サイトからスクレイピングせずにフロント／バックエンドの動作確認をするための
合成データを生成する。実在ユーザーの個人情報は一切含まない（プレイヤー名・店舗名は
すべて架空の固定文字列、機体は data/ms_list.json から選択）。

  python3 scripts/gen_sample.py            # 既定: testdata/sample_matches.json に出力
  python3 scripts/gen_sample.py -o out.json --matches 200 --seed 42

出力JSONは internal/pipeline の matchJSON（scripts/analyze.py の入力）と同じ構造。
"""
import argparse
import json
import os
import random
from datetime import datetime, timedelta

# プロジェクトルート（このスクリプトの2つ上＝scripts/の親）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_ms_pool(ms_list_path):
    with open(ms_list_path, "r", encoding="utf-8") as f:
        ms_list = json.load(f)
    # (name, image_url, cost) のタプル列
    return [(m["Name"], m["ImageURL"], m.get("Cost", 0)) for m in ms_list if m.get("Name")]


def build_actions(rng, win):
    """覚醒分析用に最低限それらしいタイムラインを生成する。"""
    actions = []
    t = rng.uniform(20, 50)
    # 覚醒ゲージMAX → 覚醒発動（F/S/Eのいずれか）
    actions.append({"action": "ex", "action_start_sec": round(t, 1), "action_end_sec": round(t, 1)})
    burst = rng.choice(["exbst-f", "exbst-s", "exbst-e"])
    t += rng.uniform(1, 8)
    actions.append({"action": burst, "action_start_sec": round(t, 1), "action_end_sec": round(t + 12, 1)})
    # 撃墜（point）。負け試合ほど多めに落ちる傾向
    deaths = rng.randint(1, 2) if win else rng.randint(1, 3)
    for _ in range(deaths):
        t += rng.uniform(20, 60)
        actions.append({"action": "point", "action_start_sec": round(t, 1), "action_end_sec": round(t, 1)})
    return actions


def make_player(rng, player_no, name, city, ms_pool, win, role):
    ms_name, ms_url, _ = rng.choice(ms_pool)
    # 役割（自分/相方/敵）と勝敗でステータスの傾向を変える
    if win:
        give = rng.randint(280, 520)
        recv = rng.randint(120, 320)
        kills = rng.randint(1, 3)
        deaths = rng.randint(0, 2)
    else:
        give = rng.randint(120, 360)
        recv = rng.randint(260, 520)
        kills = rng.randint(0, 2)
        deaths = rng.randint(1, 3)
    return {
        "player_no": player_no,
        "name": name,
        "city": city,
        "win": win,
        "ms_name": ms_name,
        "ms_image_url": ms_url,
        "score": give * 10 + kills * 1000 + rng.randint(0, 500),
        "kills": kills,
        "deaths": deaths,
        "give_damage": give,
        "receive_damage": recv,
        "ex_damage": rng.randint(0, 200),
        "ms_proficiency": str(rng.randint(1, 999)),
        "team_name": "",
        "player_level_url": "",
        "rank_badge_url": "",
        "profile_url": "",
        "shuffle_grade_url": "",
        "team_grade_url": "",
        "score_ranking": 0,
        "arcade_name": city,
        "actions": build_actions(rng, win),
    }


def generate(ms_pool, num_matches, seed):
    rng = random.Random(seed)

    # 自分の使用機体は数機体に偏らせる（機体別分析が映えるように）
    my_ms_pool = rng.sample(ms_pool, k=min(4, len(ms_pool)))
    # 相方・敵の架空プレイヤー名
    partner_names = ["アムロ", "シャア", "カミーユ", "ジュドー"]
    enemy_names = ["敵プレイヤーA", "敵プレイヤーB", "敵プレイヤーC", "敵プレイヤーD"]
    cities = ["東京", "大阪", "名古屋", "福岡", "札幌"]

    matches = []
    # 直近45日に分散させる
    base = datetime.now().replace(minute=0, second=0, microsecond=0)
    for _ in range(num_matches):
        days_ago = rng.randint(0, 45)
        # 夜（19-23時台）に偏らせつつ昼も混ぜる
        hour = rng.choice([13, 14, 20, 21, 21, 22, 22, 23])
        minute = rng.choice([0, 15, 30, 45])
        dt = base - timedelta(days=days_ago)
        dt = dt.replace(hour=hour, minute=minute)

        my_win = rng.random() < 0.54  # 勝率およそ54%

        my_ms_name, my_ms_url, _ = rng.choice(my_ms_pool)
        me = make_player(rng, 1, "自分", rng.choice(cities), my_ms_pool, my_win, "self")
        me["ms_name"], me["ms_image_url"] = my_ms_name, my_ms_url
        partner = make_player(rng, 2, rng.choice(partner_names), rng.choice(cities), ms_pool, my_win, "partner")
        enemy1 = make_player(rng, 3, rng.choice(enemy_names), rng.choice(cities), ms_pool, not my_win, "enemy")
        enemy2 = make_player(rng, 4, rng.choice(enemy_names), rng.choice(cities), ms_pool, not my_win, "enemy")

        matches.append({
            "datetime": dt.strftime("%Y-%m-%d %H:%M"),
            "game_end_sec": round(rng.uniform(90, 210), 1),
            "players": [me, partner, enemy1, enemy2],
        })

    # 日時昇順に並べる
    matches.sort(key=lambda m: m["datetime"])
    return matches


def main():
    parser = argparse.ArgumentParser(description="ダミー試合データ生成")
    parser.add_argument("-o", "--out", default=os.path.join(ROOT, "testdata", "sample_matches.json"),
                        help="出力先JSONパス")
    parser.add_argument("--ms-list", default=os.path.join(ROOT, "data", "ms_list.json"),
                        help="ms_list.jsonのパス")
    parser.add_argument("--matches", type=int, default=150, help="生成する試合数")
    parser.add_argument("--seed", type=int, default=20260622, help="乱数シード（再現性のため固定）")
    args = parser.parse_args()

    ms_pool = load_ms_pool(args.ms_list)
    matches = generate(ms_pool, args.matches, args.seed)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(matches, f, ensure_ascii=False, indent=2)
    print(f"生成: {len(matches)}試合 -> {args.out}")


if __name__ == "__main__":
    main()
