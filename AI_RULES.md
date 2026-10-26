# AI_RULES.md

# React Native Enterprise Engineering Rules

> Version: 2.0
> Purpose: Mandatory standards for AI agents and developers building a scalable, maintainable React Native app that can evolve for years without rewrites.

---

# Mission

Every implementation must optimize for:

* Long-term maintainability
* Scalability
* Consistency
* Performance
* Security
* Testability
* Reusability

New features must be addable with minimal impact on existing modules.

---

# Golden Rule

When implementing new functionality:

✅ Extend existing architecture.
✅ Reuse existing modules.
✅ Keep changes isolated and removable.

❌ Do NOT rewrite existing architecture.
❌ Do NOT modify unrelated modules.
❌ Do NOT duplicate existing functionality.

Every feature should be removable with minimal effect on the rest of the app.

---

# Rule Interpretation

Rules in this document are defaults. When a rule conflicts with reality:

1. **Existing code that violates a rule** — leave it alone unless the current task requires touching it. Do not refactor unrelated violations.
2. **Escape hatches** — where a rule says "never X", you may break it if you add a one-line comment explaining why (e.g. third-party constraint, perf measurement, etc.).
3. **When unsure** — ask before deviating, don't invent a workaround.

---

# 1. Architecture Principles

All code follows:

* SOLID
* Clean Architecture
* Separation of Concerns
* DRY / KISS
* Composition over Inheritance
* Dependency Inversion
* Feature Isolation

## Architectural Layers

```text
Presentation → Hooks → Service → Repository → API / Storage
```

Dependencies flow downward only. Lower layers never import upper layers.

---

# 2. Project Structure

```text
src/
├── app/
├── navigation/
├── theme/
├── services/
├── store/
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── utils/
│   ├── constants/
│   ├── types/
│   ├── validation/
│   └── assets/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── profile/
│   └── settings/
└── tests/
```

## Feature Structure

```text
features/feature-name/
├── api/
├── repository/
├── services/
├── hooks/
├── screens/
├── components/
├── types/
├── validation/
├── utils/
├── constants/
└── index.ts
```

Feature-specific code stays inside its feature.
Put code in `shared/` only when genuinely reused across 2+ features.

---

# 3. TypeScript Standards

* `strict: true` always.
* Prefer `unknown` over `any`.
* `any` is allowed only with an inline comment explaining why (e.g. third-party untyped lib). Do not contort types to avoid it.
* Explicitly type: API models, DTOs, domain models, navigation params, hook return types.

## Naming

```ts
interface User       // not IUser
type UserProfile
enum UserStatus
```

---

# 4. Design System & Theme

Never hardcode: colors, typography, spacing, radius, shadows, elevation, z-index.

```text
theme/
├── tokens/
│   ├── colors.ts
│   ├── spacing.ts
│   ├── typography.ts
│   ├── radius.ts
│   ├── shadows.ts
│   └── zIndex.ts
├── themes/
└── index.ts
```

✅ `color: colors.primary; padding: spacing.md;`
❌ `color: '#FF0000'; padding: 13;`

---

# 5. Component Design

Components handle: rendering, user interaction, display logic.
Components do NOT contain: API calls, business logic, data transformation, complex state.

## Size Guidelines (not hard limits)

```text
Component: ~300 lines
Hook:      ~200 lines
Service:   ~300 lines
Function:  ~50 lines
```

When exceeded, refactor *if it improves clarity*. Don't split a cohesive unit just to hit a number.

## Component Folder

```text
Component/
├── Component.tsx
├── Component.styles.ts
├── Component.types.ts
├── Component.test.tsx
└── index.ts
```

---

# 6. Reuse Strategy

Before creating a new component/hook/service/util:

1. Search `shared/`.
2. Search the current feature.
3. Search other features.
4. Check the design system.

Promote to `shared/` only when used in 2+ places. Avoid premature abstractions.

Examples of shared components:

```text
Button, Input, Avatar, Badge, Card, Modal,
Loader, EmptyState, ErrorState, BottomSheet,
ListItem, ScreenContainer
```

---

# 7. State Management

## Priority Order

```text
1. Local state
2. Custom hooks
3. Feature store
4. Global store
```

## Global state allowed for

Auth, user session, user profile, theme, app config, feature flags.

## Never global

Form state, modal state, screen filters, transient UI state.

---

# 8. Hooks

Custom hooks are required for: API interactions, business logic, data mapping, complex state.

Screens: compose UI, invoke hooks, handle navigation.
Screens do NOT: fetch data directly, transform API responses, implement business rules.

---

# 9. API & Data Layer

Never call `fetch()` / `axios()` from screens or components.

## Required flow

```text
Screen → Hook → Service → Repository → API Client
```

This gives: testability, replaceability, mockability, maintainability.

---

# 10. Network Layer

Single centralized API client in `services/api/`. Responsibilities:

* Auth & token refresh
* Retry logic
* Timeouts
* Error handling
* Logging / monitoring

No other location may configure networking.

---

# 11. Error Handling

Every async operation **that drives UI** must support:

```text
Loading | Success | Error | Empty
```

Background / fire-and-forget operations (analytics, telemetry) don't need all four — but must still log errors.

## Never

```ts
catch (error) {}        // silent swallow
```

## Required

```ts
catch (error) {
  logger.error(error);
  handleError(error);
}
```

Convert backend errors to user-friendly UI messages. Never expose raw errors.

---

# 12. Logging

Never use `console.log` / `console.warn` / `console.error` in committed code.

Use the project logger:

```ts
logger.info()
logger.warn()
logger.error()
```

Dev: verbose. Production: errors only.

---

# 13. Navigation

```text
navigation/
├── RootNavigator
├── AuthNavigator
├── MainNavigator
├── linking.ts
└── types.ts
```

* Never hardcode route strings — use typed constants.
* All routes declared in `src/navigation/types.ts`.

---

# 14. Environment & Config

All environment values originate from `.env`.

Never hardcode: URLs, API keys, secrets, analytics IDs, feature flags.

A `config/` layer validates env vars at startup and fails fast if any required value is missing.

---

# 15. Security

* Never store secrets, API keys, or tokens in source.
* Use secure storage (Keychain / Encrypted Storage / Secure Store) for sensitive data.
* Validate user input, route params, and API payloads.
* Sanitize all external input before processing.

---

# 16. Performance

Use: `FlatList`, `SectionList`, lazy loading, pagination, virtualization.

Avoid: nested FlatLists, anonymous render functions, heavy work during render.

Memoize (`useMemo`, `useCallback`, `React.memo`) only when profiling justifies it. Avoid premature memoization.

---

# 17. Dependencies

Before adding a package, verify: active maintenance, community adoption, TypeScript support, RN compatibility, security history.

Prefer smaller footprint. Avoid abandoned, duplicate, or experimental packages.

---

# 18. Testing

## Required tests

* **New hook / service / util** → ships with unit tests.
* **Bug fix** → ships with a regression test.
* **New business / validation logic** → covered.

## Not required

* UI snapshot tests for trivial components.
* Tests for one-off scripts or throwaway code.

Test behavior, not implementation details.

Recommended layers: unit + integration.

---

# 19. Accessibility

UI supports: screen readers, dynamic text sizing, accessible labels, focus management.

Interactive elements include `accessibilityLabel` and `accessibilityRole` where applicable.

---

# 20. Internationalization (i18n)

All user-facing strings go through the i18n layer. Never hardcode display text in components or screens.

✅ `t('auth.login.title')`
❌ `'Log In'`

Applies to: labels, buttons, errors, alerts, placeholders, accessibility labels.

---

# 21. Documentation

Each non-trivial feature documents: purpose, dependencies, API contracts, business rules, known limitations.

A `README.md` is required for complex features only.

---

# 22. Code Review

Every change verifies: architecture compliance, reuse, test coverage, performance, security, accessibility.

---

# 23. Refactoring

When modifying existing code:

* Preserve public contracts.
* Avoid breaking changes.
* Update tests and docs.
* Keep impact localized.

Never refactor unrelated modules during feature work.

---

# 24. AI Agent Workflow

Before generating code:

1. Search existing implementations (hooks, services, components, utils, types).
2. Follow existing patterns in the area you're touching.
3. Extend, don't replace.
4. Match naming and folder conventions already in the repo.

Never create duplicate components, services, hooks, utilities, or types.

If the existing pattern conflicts with these rules, follow the existing pattern *for this task* and flag the conflict to the user.

---

# 25. Git Standards

## Branches

```text
feature/<name>
bugfix/<name>
hotfix/<name>
refactor/<name>
chore/<name>
```

## Commits

Conventional Commits:

```text
feat(auth): add biometric login
fix(login): handle expired token
refactor(api-client): extract retry policy
```

---

# 26. Pull Requests

Every PR includes:

* **Summary** — what changed
* **Reason** — why
* **Impact** — risks / affected areas
* **Testing** — how it was verified

---

# 27. Definition of Done

Tiered by change type.

## Minimum (all changes)

```text
✓ TypeScript passes
✓ ESLint passes
✓ Build succeeds
✓ No console statements
✓ No secrets committed
✓ Uses design tokens (if UI)
✓ i18n keys used (if UI strings)
```

## Standard (features / non-trivial changes)

Everything in Minimum, plus:

```text
✓ Architecture rules followed
✓ Tests added (per §18)
✓ No duplicated code
✓ Accessibility checked (if UI)
✓ Security reviewed (if input / auth / storage)
✓ Performance reviewed (if lists / heavy work)
✓ Docs updated (if public contract changed)
```

A one-line bug fix uses Minimum. A new screen uses Standard.

---

# 28. Absolute Prohibitions

Never:

* Hardcode design values, route strings, secrets, or user-facing strings
* Call APIs from screens or components
* Duplicate existing code
* Use `console.log` in committed code
* Create God Components or God Services
* Ignore TypeScript or ESLint errors
* Bypass the architectural layers
* Silently swallow errors

`any` is discouraged but allowed with a justifying comment.

---

# Final Principle

The project must remain maintainable after hundreds of screens, hundreds of endpoints, multiple teams, multiple AI agents, and years of development.

Prioritize long-term maintainability over short-term convenience.
