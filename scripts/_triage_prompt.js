export function buildTriagePrompt({
  rawQuery,
  caseId,
  plan,
  deliverySummary,
  previewSummary,
  runnerSummary,
  qualityHintsSummary,
  designSummary,
  decisionSummary,
  baselineSummary,
  recentEvolutionLog,
  screenshotArtifacts,
  providerConfig,
}) {
  const system = [
    "你是 mini-game 演进环的 triage 路由器。读完用户 query 与 case 当前状态，输出一个 JSON 决策。",
    "输出只能是三种互斥形态之一：execute、clarify、reject。",
    "execute 必须包含 rawQuery、caseId、baselineRef、subtasks、conflicts。每个 subtask 必须有 id、stage、subIntent、specImpact、evidenceRequired、stopIfFails、dependsOn、expectedArtifacts。",
    "clarify 必须包含 rawQuery、caseId、baselineRef、clarifications、conflicts。每个 clarification 必须有 id、question、context。",
    "reject 必须包含 rawQuery、caseId、reason、guidance。",
    "禁止在 subIntent / question / reason 任何文本里出现 'Stage' / 'stage' / 'S2' / 'S3' / 'S4' / 'S5' 等内部编号；必须用游戏领域语言。",
    "拆分顺序固定为 Stage 2 修复 -> Stage 3 新增 -> Stage 4 深化 -> Stage 5 美化；同 stage 多个相近子意图合并；不同 stage 各自一个 subtask。",
    "路由判据基于用户意图，不基于 spec 表达形状：现有行为与预期不一致归修复；加入目前没有的体验归新增；玩起来不够好归深化；样子、听感、排布不舒服归美化。",
    "当用户只说继续优化、收尾、打磨或美化时，可以把 qualityHints.rubric、qualityHints.visual.warnings、DESIGN.md anchors 和 decisions.md 摘要当 backlog 线索；但明确 query 始终优先。",
    "如果 baselineKind 是 preview，说明游戏可启动试玩但 delivery evidence 可能未通过；failed expects 和 previewSummary 是修复/验收错位的重要证据。",
    "DESIGN.md 的 mustAvoid 是硬约束；任何子任务都不能把禁忌当作优化方向。",
    "specImpact 是权限预警，不决定 stage：none 表示不改 plan 契约形状；spec-correction 表示修正现有 acceptance 文本、补 mustNot、修 repro 证据；spec-shape-change 只允许新增体验。",
    "澄清话术必须使用游戏领域语言。不要问'这是 Stage 3 还是 Stage 4？'，要问'连击只显示计数，还是会影响伤害、奖励或关卡节奏？'。",
    "不要问'这个属于 Stage 5 吗？'，要问'更刺激主要是更明显的命中停顿、屏幕震动，还是音效和视觉特效更强？'。",
    "不要问'这个 shape change 要不要做？'，要问'道具栏只是显示已拾取道具，还是需要持久保存、切换和主动使用？'。",
    "只输出 JSON，不输出 Markdown。",
  ].join("\n");

  const user = JSON.stringify(
    {
      rawQuery,
      caseId,
      providerConfig: summarizeProvider(providerConfig),
      plan,
      deliverySummary,
      previewSummary,
      runnerSummary,
      qualityHintsSummary,
      designSummary,
      decisionSummary,
      baselineSummary,
      recentEvolutionLog,
      screenshotArtifacts,
      imagePolicy:
        "Do not read screenshot pixels or embed image data. Screenshot entries are path and size metadata only.",
    },
    null,
    2,
  );

  return {
    system,
    user,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

function summarizeProvider(providerConfig) {
  if (!providerConfig || typeof providerConfig !== "object") return null;
  return {
    evalProvider: providerConfig.evalProvider,
    evalModel: providerConfig.evalModel,
    evalReasoning: providerConfig.evalReasoning,
    secretPolicy: providerConfig.secretPolicy,
  };
}
