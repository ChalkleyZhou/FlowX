# Workflow OpenDesign Brainstorm + Design

Date: 2026-07-22

## Goal

- Workflow **产品构思 (BRAINSTORM)** and **设计方案 (DESIGN)** both use local OpenDesign.
- Brainstorm returns a single **Markdown** document (no structured brief JSON).
- Design still returns DesignCompletionReport / HTML artifact.
- Remove **OpenDesign 设计** from the Requirements list page; entry points live on the workflow detail stage cards.

## Flow

1. `BRAINSTORM_PENDING` → open local OpenDesign → MCP pull brainstorm context → submit markdown → stage completes → `DESIGN_PENDING`
2. `DESIGN_PENDING` → open local OpenDesign → MCP pull design context → submit design report → waiting confirmation (existing gate)

## Non-goals

- Requirement Ideation brainstorm redesign
- Merging brainstorm+design into one submit
