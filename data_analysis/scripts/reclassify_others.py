import json
import os
import time
import requests
from collections import Counter, defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "analysis_output")

API_URL = "https://api.deepseek.com/v1/chat/completions"
API_KEY = "sk-c3352e5b62dc485eac34a1aa759527c9"
MODEL = "deepseek-chat"


def call_deepseek(prompt):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    payload = {"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1}
    for attempt in range(3):
        try:
            resp = requests.post(API_URL, headers=headers, json=payload, timeout=120)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt < 2:
                time.sleep(3)
            else:
                raise


def main():
    with open(os.path.join(OUTPUT_DIR, "games_final_web.json"), "r", encoding="utf-8") as f:
        web = json.load(f)
    with open(os.path.join(OUTPUT_DIR, "games_final_app.json"), "r", encoding="utf-8") as f:
        app = json.load(f)
    all_g = web + app

    existing_cats = sorted(set(g["game_category_merged"] for g in all_g if g["game_category_merged"] != "其他工具"))
    others = [g for g in all_g if g["game_category_merged"] == "其他工具"]

    print(f"现有大类: {existing_cats}")
    print(f"其他工具项目数: {len(others)}")

    items = []
    for g in others:
        items.append({
            "id": g["project_id"],
            "prompt": g["initial_prompt"][:500],
            "original_category": g["game_category"],
            "original_subcategory": g["game_subcategory"],
        })

    cat_list = "\n".join(f"- {c}" for c in existing_cats)
    prompt = f"""你是一个游戏分类专家。以下有{len(items)}个小游戏项目，之前被归类为"其他工具"（兜底类别）。

请逐个审核每个项目，判断：
1. 是否可以归入现有大类中的某一个？如果可以，指定归入哪个大类。
2. 如果确实不属于任何现有大类，归为"其他"。

## 现有大类
{cat_list}

## 待审核项目
{json.dumps(items, ensure_ascii=False)}

## 输出格式
仅输出JSON array，每个对象包含：
- id: 项目ID
- new_category: 归入的大类名称（必须是上面现有大类之一，或"其他"）
- reason: 简短理由（10字以内）

[{{"id": "...", "new_category": "...", "reason": "..."}}]
"""

    print("\n调用LLM审核...")
    response = call_deepseek(prompt)
    text = response.strip()
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    results = json.loads(text)

    remap = {}
    for r in results:
        remap[str(r["id"])] = {"new_category": r["new_category"], "reason": r["reason"]}
        print(f"  {r['id']}: {r['new_category']} ({r['reason']})")

    with open(os.path.join(OUTPUT_DIR, "others_reclassification.json"), "w", encoding="utf-8") as f:
        json.dump(remap, f, ensure_ascii=False, indent=2)

    for dataset, path in [(web, "games_final_web.json"), (app, "games_final_app.json")]:
        changed = 0
        for g in dataset:
            pid = g["project_id"]
            if pid in remap:
                new_cat = remap[pid]["new_category"]
                g["game_category_merged"] = new_cat
                changed += 1
        with open(os.path.join(OUTPUT_DIR, path), "w", encoding="utf-8") as f:
            json.dump(dataset, f, ensure_ascii=False, indent=2)
        print(f"\n更新 {path}: {changed} 个项目重新归类")

    all_updated = web + app
    cat_dist = Counter(g["game_category_merged"] for g in all_updated)
    print(f"\n更新后类别分布 ({len(cat_dist)} 个类别):")
    for cat, count in cat_dist.most_common():
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
