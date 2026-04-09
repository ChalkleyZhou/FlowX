# FlowX Ideation Phase: One-line Requirement → Brainstorm → Demo & Design → R&D

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FlowX so a one-line requirement can be fleshed out through AI brainstorming, then visualized as demo mockups and design specs, before entering the existing R&D workflow. This closes the gap between "vague idea" and "actionable requirement."

**Architecture:** Insert a new **Ideation** phase before the existing workflow. The Ideation phase runs on the Requirement model itself (not WorkflowRun), keeping it lightweight and independent of repository context. Once the user is satisfied with the brainstorm and design, they promote the enriched requirement into a WorkflowRun as before.

**Tech Stack:** pnpm workspace, NestJS, React, TypeScript, Prisma, SQLite, Vitest

---

## Design Decisions

### Why Ideation is on Requirement, not WorkflowRun

- Ideation is about clarifying *what* to build, not *how* to build it. It doesn't need repository context or branches.
- Keeping it on Requirement means users can brainstorm without committing to a workflow. They can iterate freely.
- A Requirement can go through multiple ideation rounds before ever launching a WorkflowRun.

### Ideation stages

1. **Brainstorm** — AI expands the one-liner into a structured product brief: user stories, edge cases, success metrics, open questions. Multiple rounds allowed.
2. **Demo & Design** — AI generates UI wireframe descriptions (ASCII/text-based layout specs) and a demo scenario script. The user can revise.
3. **Finalize** — User confirms the enriched requirement. The description, acceptance criteria, and design artifacts are merged into the Requirement record, ready for WorkflowRun launch.

### Stage status model

Mirror the existing StageExecution pattern but simplified:

```
Requirement.ideationStatus: NONE → BRAINSTORM_PENDING → BRAINSTORM_WAITING_CONFIRMATION → BRAINSTORM_CONFIRMED → DESIGN_PENDING → DESIGN_WAITING_CONFIRMATION → DESIGN_CONFIRMED → FINALIZED
```

---

## File Structure

### Existing files to modify

- `prisma/schema.prisma` — Add ideation fields to Requirement, add IdeationSession / IdeationArtifact models
- `apps/api/src/common/enums.ts` — Add IdeationStatus enum, IDEATION stage type
- `apps/api/src/common/workflow-state-machine.ts` — No changes (ideation is outside the workflow state machine)
- `apps/api/src/common/types.ts` — Add ideation input/output types for AI executor
- `apps/api/src/ai/ai-executor.ts` — Add `brainstorm` and `generateDesign` methods to AIExecutor interface
- `apps/api/src/ai/codex-ai.executor.ts` — Implement brainstorm and generateDesign for Codex
- `apps/api/src/ai/mock-ai.executor.ts` — Implement brainstorm and generateDesign for Mock
- `apps/api/src/requirements/requirements.service.ts` — Add ideation orchestration methods
- `apps/api/src/requirements/requirements.controller.ts` — Add ideation REST endpoints
- `apps/api/src/requirements/dto/` — Add DTOs for ideation operations
- `apps/web/src/types.ts` — Add frontend ideation types
- `apps/web/src/api.ts` — Add ideation API client methods
- `apps/web/src/pages/RequirementsPage.tsx` — Add ideation entry point
- `apps/web/src/pages/RequirementDetailPage.tsx` — New page for requirement + ideation flow

### New files to create

- `apps/api/src/prompts/brainstorm.prompt.ts` — Prompt for expanding one-liner into product brief
- `apps/api/src/prompts/design-generation.prompt.ts` — Prompt for generating UI wireframes and demo scripts
- `apps/api/src/ai/brainstorm.output.schema.json` — JSON schema for brainstorm output
- `apps/api/src/ai/design-generation.output.schema.json` — JSON schema for design output
- `apps/web/src/pages/RequirementDetailPage.tsx` — Full requirement + ideation detail page
- `apps/web/src/components/IdeationBrainstormPanel.tsx` — Brainstorm stage UI
- `apps/web/src/components/IdeationDesignPanel.tsx` — Design stage UI

### Why this decomposition

- Ideation is Requirement-scoped, so the code lives under the existing requirements module rather than creating a new top-level module.
- AI executor gets two new methods — consistent with the existing `splitTasks`/`generatePlan`/`executeTask`/`reviewCode` pattern.
- Prompt templates follow the existing pattern in `apps/api/src/prompts/`.
- Frontend follows existing page + component structure.

---

## Task 1: Schema — Add Ideation Models to Prisma

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add IdeationStatus enum**

```prisma
enum IdeationStatus {
  NONE
  BRAINSTORM_PENDING
  BRAINSTORM_WAITING_CONFIRMATION
  BRAINSTORM_CONFIRMED
  DESIGN_PENDING
  DESIGN_WAITING_CONFIRMATION
  DESIGN_CONFIRMED
  FINALIZED
}
```

- [ ] **Step 2: Add ideation fields to Requirement model**

```prisma
model Requirement {
  // ... existing fields ...
  ideationStatus  IdeationStatus @default(NONE)
  ideationSessions IdeationSession[]
  ideationArtifacts IdeationArtifact[]
}
```

- [ ] **Step 3: Add IdeationSession model**

Captures each brainstorm/design round (like StageExecution but for ideation):

```prisma
model IdeationSession {
  id             String   @id @default(cuid())
  requirementId  String
  requirement    Requirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  stage          IdeationStage
  attempt        Int      @default(1)
  status         IdeationSessionStatus @default(PENDING)
  input          Json?
  output         Json?
  startedAt      DateTime?
  finishedAt     DateTime?
  errorMessage   String?
  statusMessage  String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([requirementId])
}

enum IdeationStage {
  BRAINSTORM
  DESIGN
}

enum IdeationSessionStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  WAITING_CONFIRMATION
}
```

- [ ] **Step 4: Add IdeationArtifact model**

Stores the finalized brainstorm brief and design artifacts separately from session output:

```prisma
model IdeationArtifact {
  id             String   @id @default(cuid())
  requirementId  String
  requirement    Requirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  type           IdeationArtifactType
  content        Json
  version        Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([requirementId])
}

enum IdeationArtifactType {
  BRAINSTORM_BRIEF
  DESIGN_SPEC
}
```

- [ ] **Step 5: Generate and push schema**

```bash
pnpm prisma:generate
pnpm --filter flowx-api exec prisma db push --schema ../../prisma/schema.prisma
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add ideation models to prisma schema"
```

---

## Task 2: Enums & Types — Add Ideation Enums and AI Types

**Files:**
- Modify: `apps/api/src/common/enums.ts`
- Modify: `apps/api/src/common/types.ts`

- [ ] **Step 1: Add ideation enums to enums.ts**

```typescript
export enum IdeationStatus {
  NONE = 'NONE',
  BRAINSTORM_PENDING = 'BRAINSTORM_PENDING',
  BRAINSTORM_WAITING_CONFIRMATION = 'BRAINSTORM_WAITING_CONFIRMATION',
  BRAINSTORM_CONFIRMED = 'BRAINSTORM_CONFIRMED',
  DESIGN_PENDING = 'DESIGN_PENDING',
  DESIGN_WAITING_CONFIRMATION = 'DESIGN_WAITING_CONFIRMATION',
  DESIGN_CONFIRMED = 'DESIGN_CONFIRMED',
  FINALIZED = 'FINALIZED',
}

export enum IdeationStage {
  BRAINSTORM = 'BRAINSTORM',
  DESIGN = 'DESIGN',
}

export enum IdeationSessionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  WAITING_CONFIRMATION = 'WAITING_CONFIRMATION',
}
```

- [ ] **Step 2: Add ideation AI types to types.ts**

```typescript
export interface BrainstormInput {
  requirementTitle: string;
  requirementDescription: string;
  previousBriefs?: BrainstormBrief[];  // for revision rounds
  humanFeedback?: string;
  workspaceContext?: string;  // workspace name, existing projects context
}

export interface BrainstormOutput {
  brief: BrainstormBrief;
}

export interface BrainstormBrief {
  expandedDescription: string;
  userStories: Array<{
    role: string;
    action: string;
    benefit: string;
  }>;
  edgeCases: string[];
  successMetrics: string[];
  openQuestions: string[];
  assumptions: string[];
  outOfScope: string[];
}

export interface GenerateDesignInput {
  requirementTitle: string;
  requirementDescription: string;
  confirmedBrief: BrainstormBrief;
  previousDesigns?: DesignSpec[];  // for revision rounds
  humanFeedback?: string;
}

export interface GenerateDesignOutput {
  design: DesignSpec;
}

export interface DesignSpec {
  overview: string;
  pages: Array<{
    name: string;
    route: string;
    layout: string;          // ASCII/text wireframe description
    keyComponents: string[];
    interactions: string[];
  }>;
  demoScenario: string;      // step-by-step walkthrough script
  dataModels: string[];      // key entities and relationships
  apiEndpoints: Array<{
    method: string;
    path: string;
    purpose: string;
  }>;
  designRationale: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/common/enums.ts apps/api/src/common/types.ts
git commit -m "feat: add ideation enums and AI types"
```

---

## Task 3: AI Executor — Add Brainstorm and GenerateDesign Methods

**Files:**
- Modify: `apps/api/src/ai/ai-executor.ts`
- Create: `apps/api/src/ai/brainstorm.output.schema.json`
- Create: `apps/api/src/ai/design-generation.output.schema.json`
- Create: `apps/api/src/prompts/brainstorm.prompt.ts`
- Create: `apps/api/src/prompts/design-generation.prompt.ts`
- Modify: `apps/api/src/ai/codex-ai.executor.ts`
- Modify: `apps/api/src/ai/mock-ai.executor.ts`

- [ ] **Step 1: Add methods to AIExecutor interface**

```typescript
// Add to AIExecutor interface:
brainstorm(input: BrainstormInput): Promise<BrainstormOutput>;
generateDesign(input: GenerateDesignInput): Promise<GenerateDesignOutput>;
```

- [ ] **Step 2: Create brainstorm output JSON schema**

Create `apps/api/src/ai/brainstorm.output.schema.json` with schema matching `BrainstormBrief` structure.

- [ ] **Step 3: Create design generation output JSON schema**

Create `apps/api/src/ai/design-generation.output.schema.json` with schema matching `DesignSpec` structure.

- [ ] **Step 4: Create brainstorm prompt template**

Create `apps/api/src/prompts/brainstorm.prompt.ts`:

```typescript
export const BRAINSTORM_PROMPT_VERSION = '1.0.0';

export function buildBrainstormPrompt(input: BrainstormInput): string {
  const parts = [
    `# Product Brainstorm`,
    ``,
    `You are a senior product manager. Expand the following one-line requirement into a comprehensive product brief.`,
    ``,
    `## Original Requirement`,
    `Title: ${input.requirementTitle}`,
    `Description: ${input.requirementDescription}`,
  ];

  if (input.workspaceContext) {
    parts.push(``, `## Workspace Context`, input.workspaceContext);
  }

  if (input.previousBriefs?.length) {
    parts.push(``, `## Previous Brainstorm Rounds`);
    input.previousBriefs.forEach((brief, i) => {
      parts.push(`### Round ${i + 1}`, JSON.stringify(brief, null, 2));
    });
  }

  if (input.humanFeedback) {
    parts.push(``, `## Human Feedback`, input.humanFeedback);
  }

  parts.push(
    ``,
    `## Output Requirements`,
    `Produce a structured product brief with:`,
    `- expandedDescription: A detailed product description (2-3 paragraphs)`,
    `- userStories: At least 3 user stories with role/action/benefit`,
    `- edgeCases: At least 3 edge cases to consider`,
    `- successMetrics: Measurable success criteria`,
    `- openQuestions: Questions that need stakeholder input`,
    `- assumptions: Assumptions you're making`,
    `- outOfScope: What is explicitly NOT in scope`,
    ``,
    `Think deeply about user needs, business value, and potential pitfalls. Be specific, not generic.`,
  );

  return parts.join('\n');
}
```

- [ ] **Step 5: Create design generation prompt template**

Create `apps/api/src/prompts/design-generation.prompt.ts`:

```typescript
export const DESIGN_GENERATION_PROMPT_VERSION = '1.0.0';

export function buildDesignGenerationPrompt(input: GenerateDesignInput): string {
  const parts = [
    `# UI Design & Demo Generation`,
    ``,
    `You are a senior product designer and UX architect. Based on the confirmed product brief, generate a UI design specification and demo scenario.`,
    ``,
    `## Requirement`,
    `Title: ${input.requirementTitle}`,
    `Description: ${input.requirementDescription}`,
    ``,
    `## Confirmed Product Brief`,
    JSON.stringify(input.confirmedBrief, null, 2),
  ];

  if (input.previousDesigns?.length) {
    parts.push(``, `## Previous Design Rounds`);
    input.previousDesigns.forEach((design, i) => {
      parts.push(`### Round ${i + 1}`, JSON.stringify(design, null, 2));
    });
  }

  if (input.humanFeedback) {
    parts.push(``, `## Human Feedback`, input.humanFeedback);
  }

  parts.push(
    ``,
    `## Output Requirements`,
    `Generate a design specification with:`,
    `- overview: High-level design approach`,
    `- pages: List of pages/views with:`,
    `  - name: Page name`,
    `  - route: URL route`,
    `  - layout: Text-based wireframe showing layout structure (use ASCII art style with [Header] [Sidebar] [Content] etc.)`,
    `  - keyComponents: List of UI components on this page`,
    `  - interactions: Key user interactions and state changes`,
    `- demoScenario: A step-by-step walkthrough script that a demo would follow`,
    `- dataModels: Key entities and their relationships`,
    `- apiEndpoints: Key API endpoints needed (method, path, purpose)`,
    `- designRationale: Why this design approach was chosen`,
    ``,
    `Make the wireframes descriptive enough that a developer could build from them. Focus on user flows and information architecture.`,
  );

  return parts.join('\n');
}
```

- [ ] **Step 6: Implement brainstorm and generateDesign in Codex executor**

Follow the same pattern as `splitTasks` and `generatePlan`:
- Build prompt from template
- Call Codex CLI with JSON schema validation
- Parse and return structured output
- Persist debug artifacts

- [ ] **Step 7: Implement brainstorm and generateDesign in Mock executor**

Return predefined brainstorm brief and design spec for testing:

```typescript
async brainstorm(input: BrainstormInput): Promise<BrainstormOutput> {
  return {
    brief: {
      expandedDescription: `Expanded description for: ${input.requirementTitle}. This feature enables users to...`,
      userStories: [
        { role: 'User', action: 'can perform the core action', benefit: 'achieves the primary goal' },
        { role: 'Admin', action: 'can manage the feature settings', benefit: 'maintains control over the feature' },
        { role: 'User', action: 'can view the results', benefit: 'gets visibility into outcomes' },
      ],
      edgeCases: ['Empty state with no data', 'Concurrent access by multiple users', 'Very large dataset performance'],
      successMetrics: ['Task completion rate > 80%', 'Average time to complete < 30 seconds', 'User satisfaction score > 4/5'],
      openQuestions: ['Should this support offline mode?', 'What is the expected scale?'],
      assumptions: ['Users have basic technical literacy', 'Network connectivity is available'],
      outOfScope: ['Mobile native app', 'Internationalization'],
    },
  };
}

async generateDesign(input: GenerateDesignInput): Promise<GenerateDesignOutput> {
  return {
    design: {
      overview: 'A clean, minimal interface following existing design patterns.',
      pages: [
        {
          name: 'Main Page',
          route: '/feature',
          layout: '[Header]\n[Sidebar | Main Content Area]\n[Footer]',
          keyComponents: ['FeatureList', 'SearchBar', 'FilterPanel'],
          interactions: ['Click item to view details', 'Search filters results in real-time'],
        },
      ],
      demoScenario: '1. Navigate to /feature\n2. See the list of items\n3. Click an item to view details\n4. Return to list',
      dataModels: ['Feature: { id, name, status, createdAt }'],
      apiEndpoints: [
        { method: 'GET', path: '/api/features', purpose: 'List features' },
        { method: 'GET', path: '/api/features/:id', purpose: 'Get feature detail' },
      ],
      designRationale: 'Follows existing patterns for consistency and low learning curve.',
    },
  };
}
```

- [ ] **Step 8: Update the copy-ai-schemas script if needed to include new JSON schemas**

Check `apps/api/scripts/copy-ai-schemas.mjs` and ensure new schema files are included in the build copy step.

- [ ] **Step 9: Run tests**

```bash
pnpm --filter flowx-api test
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/ai/ apps/api/src/prompts/
git commit -m "feat: add brainstorm and design generation to AI executor"
```

---

## Task 4: Backend Service & Controller — Ideation Orchestration

**Files:**
- Modify: `apps/api/src/requirements/requirements.service.ts`
- Modify: `apps/api/src/requirements/requirements.controller.ts`
- Create: `apps/api/src/requirements/dto/ideation.dto.ts`

- [ ] **Step 1: Create ideation DTOs**

Create `apps/api/src/requirements/dto/ideation.dto.ts`:

```typescript
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class StartBrainstormDto {
  @IsOptional()
  @IsString()
  humanHint?: string;  // Optional initial hint for brainstorm direction
}

export class ReviseBrainstormDto {
  @IsString()
  feedback!: string;
}

export class ConfirmBrainstormDto {}

export class StartDesignDto {
  @IsOptional()
  @IsString()
  humanHint?: string;
}

export class ReviseDesignDto {
  @IsString()
  feedback!: string;
}

export class ConfirmDesignDto {}

export class FinalizeIdeationDto {}
```

- [ ] **Step 2: Add ideation methods to RequirementsService**

Key methods to add:

```typescript
// Brainstorm phase
async startBrainstorm(requirementId: string, userId: string, hint?: string): Promise<Requirement>
async reviseBrainstorm(requirementId: string, feedback: string): Promise<Requirement>
async confirmBrainstorm(requirementId: string): Promise<Requirement>

// Design phase
async startDesign(requirementId: string, userId: string, hint?: string): Promise<Requirement>
async reviseDesign(requirementId: string, feedback: string): Promise<Requirement>
async confirmDesign(requirementId: string): Promise<Requirement>

// Finalize
async finalizeIdeation(requirementId: string): Promise<Requirement>

// Helpers
private async runBrainstormAI(requirement, session, hint?, feedback?)
private async runDesignAI(requirement, session, feedback?)
private validateIdeationTransition(current: IdeationStatus, target: IdeationStatus): boolean
```

**Ideation state transitions:**
```
NONE → BRAINSTORM_PENDING (startBrainstorm)
BRAINSTORM_WAITING_CONFIRMATION → BRAINSTORM_PENDING (reviseBrainstorm)
BRAINSTORM_WAITING_CONFIRMATION → BRAINSTORM_CONFIRMED (confirmBrainstorm)
BRAINSTORM_CONFIRMED → DESIGN_PENDING (startDesign)
DESIGN_WAITING_CONFIRMATION → DESIGN_PENDING (reviseDesign)
DESIGN_WAITING_CONFIRMATION → DESIGN_CONFIRMED (confirmDesign)
DESIGN_CONFIRMED → FINALIZED (finalizeIdeation)
```

**On finalize:** Merge brainstorm brief content into `requirement.description` and `requirement.acceptanceCriteria`. Store design spec as an IdeationArtifact. The requirement is now enriched and ready for WorkflowRun launch.

- [ ] **Step 3: Add ideation REST endpoints to RequirementsController**

```typescript
// Brainstorm
@Post(':id/brainstorm/run')
@Post(':id/brainstorm/revise')
@Post(':id/brainstorm/confirm')

// Design
@Post(':id/design/run')
@Post(':id/design/revise')
@Post(':id/design/confirm')

// Finalize
@Post(':id/ideation/finalize')
```

All endpoints return the updated Requirement with ideationSessions and ideationArtifacts included.

- [ ] **Step 4: Register DTOs if the requirements module uses validation pipes**

Ensure the new DTOs are properly validated.

- [ ] **Step 5: Run tests**

```bash
pnpm --filter flowx-api test
pnpm --filter flowx-api build
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/requirements/
git commit -m "feat: add ideation orchestration to requirements service"
```

---

## Task 5: Frontend — Requirement Detail Page with Ideation Flow

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/pages/RequirementDetailPage.tsx`
- Create: `apps/web/src/components/IdeationBrainstormPanel.tsx`
- Create: `apps/web/src/components/IdeationDesignPanel.tsx`
- Modify: `apps/web/src/App.tsx` — Add route for requirement detail

- [ ] **Step 1: Add ideation types to types.ts**

```typescript
export interface IdeationSession {
  id: string;
  stage: 'BRAINSTORM' | 'DESIGN';
  attempt: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING_CONFIRMATION';
  input: any;
  output: any;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  statusMessage: string | null;
}

export interface IdeationArtifact {
  id: string;
  type: 'BRAINSTORM_BRIEF' | 'DESIGN_SPEC';
  content: any;
  version: number;
}

// Update Requirement type to include:
// ideationStatus: string;
// ideationSessions: IdeationSession[];
// ideationArtifacts: IdeationArtifact[];
```

- [ ] **Step 2: Add ideation API methods to api.ts**

```typescript
// Brainstorm
startBrainstorm(requirementId: string, hint?: string): Promise<Requirement>
reviseBrainstorm(requirementId: string, feedback: string): Promise<Requirement>
confirmBrainstorm(requirementId: string): Promise<Requirement>

// Design
startDesign(requirementId: string, hint?: string): Promise<Requirement>
reviseDesign(requirementId: string, feedback: string): Promise<Requirement>
confirmDesign(requirementId: string): Promise<Requirement>

// Finalize
finalizeIdeation(requirementId: string): Promise<Requirement>
```

- [ ] **Step 3: Create IdeationBrainstormPanel component**

Displays:
- Current brainstorm brief (expandedDescription, userStories, edgeCases, successMetrics, openQuestions, assumptions, outOfScope)
- Session status (running spinner, waiting confirmation badge)
- Action buttons: Run Brainstorm, Provide Feedback & Revise, Confirm Brief
- Human feedback textarea for revision

- [ ] **Step 4: Create IdeationDesignPanel component**

Displays:
- Design spec: pages with wireframe layouts, demo scenario, data models, API endpoints
- Session status
- Action buttons: Run Design, Provide Feedback & Revise, Confirm Design
- Human feedback textarea for revision

- [ ] **Step 5: Create RequirementDetailPage**

Layout:
- Header: Requirement title, status badges (ideation status + active workflow status)
- Left sidebar: Requirement info (project, workspace, repositories, acceptance criteria)
- Main content: Ideation flow with tabs or steps
  - Step 1: Original requirement (editable if NONE)
  - Step 2: Brainstorm panel
  - Step 3: Design panel
  - Step 4: Finalize & Launch Workflow button
- Auto-refresh when ideation session is RUNNING (same 2.5s polling as WorkflowRunDetailPage)

- [ ] **Step 6: Add route to App.tsx**

```typescript
<Route path="/requirements/:id" element={<RequirementDetailPage />} />
```

- [ ] **Step 7: Update RequirementsPage to link to detail page**

Add click handler on requirement cards to navigate to `/requirements/:id`.

- [ ] **Step 8: Update workflow launch to show enriched requirement info**

When launching a workflow from a finalized requirement, pre-populate with the enriched description and acceptance criteria from the brainstorm brief.

- [ ] **Step 9: Run tests**

```bash
pnpm --filter flowx-web test
pnpm --filter flowx-web build
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/
git commit -m "feat: add requirement detail page with ideation flow"
```

---

## Task 6: Integration & Validation

**Files:**
- Potentially modify any files from previous tasks based on testing results

- [ ] **Step 1: Full build and test**

```bash
pnpm check
```

- [ ] **Step 2: Manual integration test — brainstorm flow**

1. Create a requirement with a one-line description (e.g., "用户可以给需求添加标签")
2. Navigate to requirement detail page
3. Click "Run Brainstorm"
4. Wait for AI output
5. Review the brainstorm brief
6. Click "Confirm Brief"

- [ ] **Step 3: Manual integration test — design flow**

1. From a brainstorm-confirmed requirement, click "Run Design"
2. Wait for AI output
3. Review the design spec
4. Provide feedback and revise
5. Confirm the design

- [ ] **Step 4: Manual integration test — finalize and launch**

1. Click "Finalize Ideation"
2. Verify requirement description is enriched
3. Launch workflow
4. Verify the enriched requirement flows into task split

- [ ] **Step 5: Update AGENTS.md with ideation subsystem info**

Add `apps/api/src/requirements/` to high-risk zones since it now contains ideation orchestration logic.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete ideation phase integration"
```

---

## Self-Review

### Spec coverage

- **One-line → brainstorm**: Covered by brainstorm prompt + AI executor method + session orchestration
- **Brainstorm → design**: Covered by design prompt + AI executor method + state transitions
- **Design → R&D workflow**: Covered by finalize step that enriches requirement before workflow launch
- **Human confirmation gates**: Covered at each stage (brainstorm confirm, design confirm, finalize)
- **Revision loops**: Covered by revise endpoints with human feedback at both brainstorm and design stages
- **Mock executor**: Covered for testing without real AI

### Placeholder scan

- No `TODO`, `TBD`, or "implement later" placeholders.
- Every task names exact files, methods, and expected behaviors.

### State transition consistency

- IdeationStatus follows the same WAITING_CONFIRMATION pattern as WorkflowRunStatus
- IdeationSession mirrors StageExecution structure
- State transitions are explicitly validated in the service layer

### Risk assessment

- **Low risk**: Schema changes (additive only, no existing columns modified)
- **Low risk**: AI executor additions (new methods, no existing interface changes)
- **Medium risk**: RequirementsService additions (existing methods untouched, new methods added)
- **Medium risk**: Frontend new page (no existing pages modified beyond adding a navigation link)

## Recommended Rollout Order

1. Task 1 (Schema) — Foundation for everything else
2. Task 2 (Enums & Types) — Type definitions used by all other tasks
3. Task 3 (AI Executor) — Core AI capability
4. Task 4 (Backend Service) — Orchestration logic
5. Task 5 (Frontend) — User-facing flow
6. Task 6 (Integration) — End-to-end validation

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-09-ideation-phase.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
