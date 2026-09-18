# Brand assets

## `github-social-preview.png`

The card every link to this repository renders as — on X, LinkedIn, Slack,
Discord, iMessage and Teams. Generated from `/github-card` on the website, so
it stays in step with the social card kit rather than being a separate design.

**GitHub exposes no API for the social preview.** Not REST, not GraphQL. The
upload is manual, and it is the only manual step in this pipeline.

### When to redo it

Any change to `apps/website/src/app/card/`, to the positioning copy in
`apps/website/src/lib/positioning.ts`, or to the brand palette. Regenerate,
review the PNG, commit it, and upload again — the uploaded copy does not
update itself.

### Regenerating

```bash
npm run card:github                                    # from production
npm run card:github -- --origin http://localhost:3000  # from a local serve
```

The script refuses to write anything that is not a 1280x640 PNG, so a 404 or
an error page cannot be committed as a card.

### Uploading

1. Open <https://github.com/cacheplane/threadplane/settings>
2. General -> Social preview -> Edit -> Upload an image (this is the
   repository's own setting, not an organization-level one)
3. Select `docs/brand/github-social-preview.png`

### Verifying

```bash
curl -sL https://github.com/cacheplane/threadplane | grep 'og:image"'
```

A `repository-images.githubusercontent.com` URL means the upload took. An
`opengraph.githubassets.com` URL means GitHub is still serving its generic
auto-generated card.

Then check the real thing, because X and LinkedIn cache aggressively:

- <https://cards-dev.twitter.com/validator>
- <https://www.linkedin.com/post-inspector/>
