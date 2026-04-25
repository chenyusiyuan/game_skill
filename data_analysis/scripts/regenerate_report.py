import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "analysis_output")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "aggregate_and_report.py")).read().split("def main():")[0])

with open(os.path.join(OUTPUT_DIR, "games_final_web.json"), "r", encoding="utf-8") as f:
    web = json.load(f)
with open(os.path.join(OUTPUT_DIR, "games_final_app.json"), "r", encoding="utf-8") as f:
    app = json.load(f)

all_g = web + app
print(f"Web: {len(web)}, App: {len(app)}, Total: {len(all_g)}")

agg = generate_analysis(all_g, "小游戏整体聚合统计分析报告")
web_a = generate_analysis(web, "Web小游戏统计分析报告")
app_a = generate_analysis(app, "App小游戏统计分析报告")

for name, analysis in [("final_analysis_aggregate.json", agg), ("final_analysis_web.json", web_a), ("final_analysis_app.json", app_a)]:
    with open(os.path.join(OUTPUT_DIR, name), "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)

for name, analysis in [("final_report_aggregate.md", agg), ("final_report_web.md", web_a), ("final_report_app.md", app_a)]:
    generate_markdown(analysis, os.path.join(OUTPUT_DIR, name))

print("报告生成完成！")
for f in sorted(os.listdir(OUTPUT_DIR)):
    if f.startswith("final_"):
        sz = os.path.getsize(os.path.join(OUTPUT_DIR, f))
        print(f"  {f} ({sz/1024:.1f} KB)")
