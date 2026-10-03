# Publishing dsh-skillbox

Releases go out through **npm Trusted Publishing (OIDC)**: GitHub Actions proves its identity to npm with a per-run, short-lived token, so this repository holds **no npm credential at all**.

## Why not a token

| | `NPM_TOKEN` secret | Trusted Publishing |
|---|---|---|
| Credential | long-lived token, expires, must be rotated | none — a per-run OIDC JWT that dies in minutes |
| If it leaks | anyone can publish as you | nothing to leak |
| 2FA | depends on the token's bypass setting | satisfied by the OIDC exchange |
| Provenance | manual `--provenance` | attached automatically |

Token expiry is therefore a non-issue: there is no token to expire.

## One-time setup

On the npm website, once per package:

**Package → Settings → Trusted Publisher → GitHub Actions**

| Field | Value |
|---|---|
| Organization or user | `BB0027` |
| Repository | `dsh-skillbox` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |

Requirements: a GitHub-hosted runner (or any OIDC-capable runner) and npm CLI ≥ 11.5.1 — the workflow uses Node 24, which ships it.

The package must already exist on npm before a trusted publisher can be registered. `dsh-skillbox` does (see the published versions), so this is not a blocker here.

## Releasing

```bash
# 1. bump the version in package.json and add a CHANGELOG entry
# 2. commit and push
git commit -am "release 0.2.2"
git push

# 3. tag and push — this triggers the publish workflow
git tag v0.2.2
git push origin v0.2.2
```

The workflow refuses to publish when the tag and `package.json` disagree, and refuses to run when a token is configured (so a stray secret can never silently replace OIDC).

You can also trigger it by hand from **Actions → publish → Run workflow**; a manual run publishes whatever version is on the selected ref.

## After the switch

- Revoke every npm access token you created for this package: with trusted publishing, tokens are only a liability.
- A local `npm publish` from your machine still requires a token — that path intentionally stops working once tokens are gone. Use the workflow instead.
- If the repository or the workflow file is **renamed**, update the trusted publisher registration to match, or npm will reject the exchange. The registration itself never expires.
- Publishing from this workflow goes straight to `registry.npmjs.org`; the Chinese mirror (`registry.npmmirror.com`) syncs it shortly after.

## Maintainer note: pushing changes to `.github/workflows/`

A credential that pushes workflow files needs GitHub's **`workflow`** scope (classic
token) or the **Workflows: Read and write** repository permission (fine-grained token).
Without it the push is rejected with:

```
! [remote rejected] main -> main (refusing to allow a Personal Access Token to
  create or update workflow `.github/workflows/publish.yml` without `workflow` scope)
```

Only that file is blocked — commits that touch anything else still go through.
Granting the permission does not change the token string.

## Troubleshooting: `ENEEDAUTH` from a trusted-publishing run

A missing or mismatched trusted-publisher registration does **not** say so directly. npm
attempts the OIDC exchange and the registry answers 404, which npm reports as an auth
problem. In npm's own debug log (`~/.npm/_logs/*-debug-0.log`) it looks like this:

```
http fetch POST 404 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/<pkg>
verbose oidc Failed token exchange request with body message: OIDC token exchange error - package not found
error code ENEEDAUTH
```

"package not found" here means *no publisher configuration matched this workflow*, not
that the package is missing. Check, in order: the registering account owns the package;
the organization/user and repository strings match exactly; the workflow filename is the
filename only (`publish.yml`, no path); the Environment name is empty unless the workflow
declares the same `environment:`; and **Allow npm publish** is checked.

The workflow prints these lines itself: its last step dumps the matching debug-log lines
when publishing fails.
