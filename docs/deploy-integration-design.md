# Deploy Integration Design

## Goals

- Keep CI/CD integration isolated from the open-source core workflow logic.
- Allow swapping Rokid OPS, Jenkins, GitLab CI, GitHub Actions, or other platforms with minimal business-layer changes.
- Support repository-level configurable deploy templates plus runtime overrides.
- Preserve auditability for each deploy trigger request and third-party response.

## Design Principles

- FlowX core only understands deploy domain actions such as `preview` and `createJob`.
- Third-party field names and request formats live inside provider implementations.
- Sensitive platform connection settings stay in environment variables.
- Repository-specific defaults are stored in database records, not hardcoded in source.
- Runtime values such as branch, commit, version, and image are supplied per job request.

## Layering

### 1. Core deploy domain

The open-source repo contains:

- `DeployService`
- `DeployController`
- `DeployProvider` interface
- provider registry
- default `noop` provider
- Prisma models for config and job records

This layer never depends on Rokid-specific field names directly.

### 2. Provider adapters

Each CI/CD platform is implemented as a provider adapter:

- `noop`
- `rokid-ops`
- `jenkins`
- `gitlab-ci`

The adapter converts FlowX deploy inputs into the third-party payload format.

### 3. Private extensions

Internal-only providers should live outside the open-source default path:

- a private npm package such as `@company/flowx-deploy-provider-rokid`
- or a private source directory excluded from open-source release

The current repository will include only the extension points and a safe default `noop` provider.

## Configuration Strategy

### Environment variables

Used for system-level and sensitive settings:

- `DEPLOY_PROVIDER`
- `DEPLOY_PROVIDER_TIMEOUT_MS`
- `DEPLOY_PROVIDER_BASE_URL`
- `DEPLOY_PROVIDER_AUTH_TOKEN`

These are optional in open-source mode. If absent, FlowX falls back to `noop`.

### Repository deploy config

Stored per repository in database:

- selected `provider`
- whether deploy is enabled
- reusable provider template config
- optional metadata

This is where repository-specific defaults like `env`, `ops`, `k8s_name`, `project_name`, `jenkins`, `id`, and `folder` belong.

### Runtime overrides

Passed when creating a deploy job:

- `branch`
- `commit`
- `version`
- `versionImage`
- `image`
- ad hoc payload overrides

These are merged on top of the repository config to produce the final provider request payload.

## Data Model

### `RepositoryDeployConfig`

One record per repository.

Fields:

- `repositoryId`
- `enabled`
- `provider`
- `configJson`
- `createdAt`
- `updatedAt`

`configJson` stores provider-specific default template values.

### `DeployJobRecord`

One record per deploy trigger attempt.

Fields:

- `projectId` optional
- `repositoryId`
- `workflowRunId` optional
- `provider`
- `status`
- `targetEnv`
- `branch`
- `commitSha`
- `version`
- `versionImage`
- `image`
- `requestedBy`
- `requestPayload`
- `responsePayload`
- `externalJobId`
- `externalJobUrl`
- `errorMessage`
- `createdAt`
- `updatedAt`

This table is intended for audit history, troubleshooting, retries, and future status polling.

## Core Interfaces

### `DeployProvider`

```ts
interface DeployProvider {
  readonly id: string;
  readonly label: string;

  preview(input: DeployResolvedJobInput): Promise<DeployPreviewResult>;
  createJob(input: DeployResolvedJobInput): Promise<DeployCreateJobResult>;
}
```

### Resolved input shape

FlowX resolves a generic input before handing it to a provider:

```ts
type DeployResolvedJobInput = {
  repositoryId: string;
  projectId?: string | null;
  workflowRunId?: string | null;
  provider: string;
  requestedBy?: string | null;
  env?: string | null;
  branch?: string | null;
  commit?: string | null;
  version?: string | null;
  versionImage?: string | null;
  image?: string | null;
  config: Record<string, unknown>;
  overrides: Record<string, unknown>;
};
```

The provider is responsible for translating this to its own external payload.

## API Design

### Repository config

- `GET /repositories/:id/deploy-config`
- `PUT /repositories/:id/deploy-config`

### Provider info

- `GET /deploy/providers`

### Preview and trigger

- `POST /repositories/:id/deploy/preview`
- `POST /repositories/:id/deploy/jobs`
- `GET /repositories/:id/deploy/jobs`

## Rokid OPS Mapping

The current Rokid OPS payload can be expressed as template defaults plus runtime values.

Template defaults example:

```json
{
  "env": "dev",
  "custom": "false",
  "first": "false",
  "grayscale": "false",
  "scan_code": "false",
  "StartWith": "test",
  "ops": "prod",
  "k8s_name": "default",
  "project_name": "default",
  "jenkins": "x-open-platform-docs",
  "id": "626",
  "folder": ""
}
```

Runtime values example:

```json
{
  "commit": "abc123",
  "BRANCH": "feature_2.1.7",
  "version": "2.1.7",
  "version_image": "2.1.7-build.3",
  "image": "registry.example.com/app:2.1.7-build.3"
}
```

The Rokid provider should merge and map these values to:

- `branch -> BRANCH`
- `versionImage -> version_image`
- repository defaults remain in provider config

## Initial Scope

This first implementation includes:

- deploy domain module
- provider abstraction and registry
- `noop` provider
- repository-level config CRUD
- deploy preview
- deploy job record creation

This first implementation intentionally does not include:

- automatic workflow-stage deployment
- status polling
- retries
- rollback
- provider-specific status polling

## Rokid OPS Runtime Configuration

To enable the `rokid-ops` provider, configure environment variables on the API side:

```env
DEPLOY_PROVIDER=rokid-ops
DEPLOY_ROKID_OPS_CREATE_JOB_URL=http://ops-manage.rokid-inc.com/api/cicd/app/createJob
DEPLOY_PROVIDER_TIMEOUT_MS=10000
```

Optional auth headers:

```env
DEPLOY_PROVIDER_AUTH_TOKEN=
DEPLOY_PROVIDER_AUTH_HEADER=Authorization
DEPLOY_PROVIDER_AUTH_PREFIX=Bearer
```

Recommended repository deploy config:

```json
{
  "enabled": true,
  "provider": "rokid-ops",
  "config": {
    "env": "dev",
    "version": "",
    "version_image": "",
    "custom": "false",
    "first": "false",
    "grayscale": "false",
    "scan_code": "false",
    "StartWith": "test",
    "ops": "prod",
    "k8s_name": "default",
    "project_name": "default",
    "commit": "",
    "BRANCH": "feature_2.1.7",
    "image": "",
    "jenkins": "x-open-platform-docs",
    "id": "626",
    "folder": ""
  }
}
```

At runtime, `branch`, `commit`, `version`, `versionImage`, and `image` passed to deploy APIs override the template values above.

## Rollout Path

1. Ship open-source deploy module with `noop`.
2. Add private Rokid provider package that implements `DeployProvider`.
3. Select provider per environment or per repository.
4. Optionally add workflow post-action hooks later without mixing deploy concerns into the main state machine.
