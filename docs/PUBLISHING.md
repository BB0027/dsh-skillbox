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
