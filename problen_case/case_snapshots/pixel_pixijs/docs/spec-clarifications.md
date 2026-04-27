# Spec Clarifications: pixel_pixijs-001

## Status
assumed

## Questions
None - the PRD rules are sufficiently explicit with clear triggers, conditions, and effects.

## Assumptions

### rule: @rule(pig-attack) - Attack Check Timing
- **decision**: Attack check triggers when pig enters a new edge (top/right/bottom/left), not every slot movement
- **reason**: Original requirement explicitly states "每经过一个方向时检查正对方向第一个目标块"; checking per edge aligns with the position-limited targeting hard-rule and prevents excessive attacks that would trivialize gameplay

### rule: @rule(pig-move) - Movement Speed
- **decision**: Pig moves 1 slot per game tick (60 ticks per second typical)
- **reason**: PRD specifies tick-based movement; speed can be adjusted but 1 slot/tick provides good pacing for 6x6 board

### rule: @rule(pig-recycle) - Recycling Threshold
- **decision**: Pig completes one full loop when it returns to its starting edge after visiting all 4 edges
- **reason**: PRD trigger "绕传送带一周" clearly indicates completing a full circuit; this gives pigs multiple chances to attack matching blocks

### rule: Multiple Pigs on Conveyor
- **decision**: Multiple pigs can coexist on the conveyor belt without blocking each other; each pig moves independently
- **reason**: PRD states "传送带上可以同时存在多只小猪" with capacity limit; no collision between pigs mentioned; this allows strategic deployment of multiple pigs

### rule: @rule(lose-check) - Lose Condition Timing
- **decision**: Lose condition checked after all pigs are exhausted and conveyor is empty, not during active gameplay
- **reason**: Prevents premature loss detection; gives player full opportunity to use all resources before determining failure

## Hard-Rule Compliance Notes

### @constraint(no-global-autoaim)
- `pig-attack` uses `findFirstBlock(pig.position)` which only searches in the direction the pig is facing
- Target selection is strictly position-based, not global

### @constraint(single-target-attack)
- `pig-attack-hit` affects exactly one target: `target.hp -= 1`
- No multi-target or AoE logic in any rule

### @constraint(no-pierce-attack)
- `findFirstBlock` returns only the first non-removed block in the facing direction
- No logic to skip blocks or attack through obstacles

## Expand Notes
- mechanic-decomposer must map pig-attack to edge-enter trigger, not per-slot
- rule/event-graph expander must implement findFirstBlock as directional search with first-match return
- conveyor belt has 4 edges × 6 slots = 24 total positions
- pig state machine: waiting → on-belt → (attacking) → recycled/exhausted
