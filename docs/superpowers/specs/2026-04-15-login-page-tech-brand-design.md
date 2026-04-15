# Login Page Tech-Brand Redesign (AI Product R&D Efficiency Platform)

## Context

The current login page already supports both account/password and DingTalk flows, but its visual tone is still closer to an admin tool than a product website hero. The product has evolved from a narrow "AI delivery console" into an "AI Product R&D Efficiency Platform", so the login page should communicate a broader value narrative while preserving existing authentication behaviors.

This design updates visual presentation and copy only. Authentication logic, API flows, and validation behavior remain unchanged.

## Goals

1. Present a "tech-brand official website" first impression while keeping the current dual-auth flows.
2. Align top-level messaging with "AI Product R&D Efficiency Platform".
3. Improve visual hierarchy so users understand platform value before authentication options.
4. Preserve usability and readability across desktop and mobile.

## Non-Goals

- No changes to login/register/OAuth backend APIs.
- No changes to auth state handling or redirect semantics.
- No animation-heavy or neon-heavy visual treatment.
- No new authentication methods.

## Chosen Direction

### Visual style direction

- Balanced tech style: dark and modern, but restrained.
- Product-value hero emphasis on the left side.
- Showcase-oriented authentication panel on the right side.

### Alternatives considered

1. Heavy neon dark theme: higher visual impact, but higher risk of visual noise and lower long-term readability.
2. High-glass flagship style: premium look, but more complex and easier to over-style.
3. Light enterprise style: clean and stable, but weaker tech identity.

Recommended and approved approach: balanced dark tech style with restrained effects and stronger value messaging.

## Information Architecture

### Layout

- Keep two-column structure on desktop:
  - Left (58-62%): product value hero content.
  - Right (38-42%): authentication card.
- Mobile/tablet collapse to single-column:
  - Auth card shown first for task completion priority.
  - Hero content follows with reduced decorative density.

### Left hero content structure

1. Brand mark (`FlowXLogo`) at top.
2. Hero title (2-line value statement) centered on "AI Product R&D Efficiency Platform".
3. Supporting paragraph describing end-to-end product R&D flow value.
4. Three concise value points:
  - End-to-end product/R&D collaboration
  - Structured process assets
  - Iterative closed-loop improvement
5. Lightweight trust/support statement at bottom.

### Right auth panel structure

1. Eyebrow: "认证中心".
2. Heading: "进入 AI 产研效能平台".
3. Supporting description focused on unified collaboration/iteration context.
4. Mode switch (login/register).
5. Form fields.
6. Primary CTA.
7. Divider text.
8. DingTalk CTA.
9. Inline error alert at top of panel body when needed.

## Copy Strategy

Use platform-level wording that reflects expanded scope beyond "delivery".

### Hero copy (proposed)

- Primary:
  - "AI 产研效能平台"
  - "让需求、研发与审查在同一条可控流程中协同"
- Secondary:
  - "覆盖从需求构思、方案确认、执行落地到审查闭环的全链路，让每次迭代都有记录、有反馈、可继续推进。"

### Value points (proposed)

1. "全链路产研协同": demand, plan, execution, review, issue tracking in one flow.
2. "结构化过程资产": reusable structured outputs from each stage.
3. "迭代闭环提效": issues and bugs can loop back into the next iteration.

### Auth card copy (proposed)

- Title: "进入 AI 产研效能平台"
- Description: "使用账号或企业身份登录，进入统一的产研协作与迭代闭环工作台。"

## Visual System Rules

### Background and atmosphere

- Deep blue-black gradient base.
- 1-2 low-opacity radial glows (blue/cyan).
- Optional subtle grid/noise texture at low contrast.
- Avoid strong neon strokes and high-frequency motion.

### Card and controls

- Right panel uses soft glass feeling (subtle transparency, thin border, soft shadow).
- Inputs: consistent radius, increased internal spacing, clear focus ring.
- Primary button: branded blue emphasis, restrained hover lift.
- Secondary button: low-contrast outline for clear hierarchy.

### Typography and spacing

- Hero heading larger and tighter.
- Body and feature text with comfortable line height.
- Consistent spacing rhythm between title/description/features/CTAs.

### Accessibility and readability

- Strong contrast for headings and primary actions.
- Medium-high contrast for body copy.
- State visibility for disabled/loading/error remains explicit.

## Interaction and Data Flow

No behavioral change to auth logic. Existing flows remain:

- Account login -> `api.loginByPassword` -> `applySession`.
- Register -> `api.registerByPassword` -> `applySession`.
- DingTalk login redirect -> callback token/session flow -> optional organization selection.
- Existing error handling via inline alert + toast remains.

UI redesign only changes visual layout, copy, and styling tokens/classes.

## Error Handling

- Keep current inline destructive alert in auth card for login failures.
- Keep existing form validation errors and submission disabled states.
- Keep organization selection modal behavior unchanged.

## Testing Strategy

### Existing tests expected to remain stable

- `LoginPage.test.tsx` login success flow.
- `LoginPage.test.tsx` OAuth callback idempotency.

### Test updates required

- Update text assertions if tests check old hero/auth copy.
- Preserve selectors used by tests (`#login-account`, `#login-password`, `form`).
- Add/adjust one rendering assertion to ensure new platform title appears.

### Manual verification checklist

1. Desktop: left hero + right auth card render with new hierarchy.
2. Mobile: stacked layout maintains auth-first order.
3. Login/register toggle visual states remain clear.
4. Disabled/loading states still obvious.
5. DingTalk button remains discoverable and functional.

## Implementation Scope (UI-only)

Primary file:

- `apps/web/src/pages/LoginPage.tsx`

Potentially touched supporting styles/classes:

- Existing utility classes in-place within LoginPage component.
- No backend or API client code modifications.

## Risks and Mitigations

1. Risk: over-styling hurts readability.
  - Mitigation: enforce restrained glow/contrast rules.
2. Risk: copy updates break brittle text assertions.
  - Mitigation: update tests intentionally and keep semantic selectors stable.
3. Risk: mobile hero density pushes form too far down.
  - Mitigation: auth-first stacking and reduced decorative payload on small screens.

## Acceptance Criteria

1. Login page communicates "AI 产研效能平台" positioning through headline and supporting copy.
2. Visual style feels like a tech-brand website while remaining restrained.
3. Existing auth flows and behavior remain functionally unchanged.
4. Web tests pass after text assertion updates.