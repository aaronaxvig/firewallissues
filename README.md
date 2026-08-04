# firewallissues
An alternative view of issues documented by our favorite firewall vendor.

Feel free to host your own version, or use [the one I host](https://firewallissues.axvig.com/).

Inspired by [Pixi888's](https://www.reddit.com/user/Pixi888/) creation [bugidsearch.com](https://bugidsearch.com/).

## Data updates ##

The preferred way to add known and addressed issues for newly released versions
is to save the full issue-table HTML from the release notes webpage as a
reference file, then let the automated pipeline handle the rest.

### Workflow (preferred) ###

1. Navigate to the relevant Palo Alto Networks release notes page for the
   product and version you want to add.
2. Open DevTools, locate the `<table>` element containing the issue list, and
   copy its outer HTML.
3. Save the HTML as a file under `reference/<Product>/<addressed|known>/`.
   Name it with the exact version string and a `.html` extension
   (e.g. `reference/PAN-OS/addressed/11.1.13-h10.html`).
4. Optionally update `reference/urls.json` with the source URL for the page
   (currently tracked manually; the file is a reference for the deployment
   workflow).
5. Commit the reference HTML file(s) and submit a pull request.

After a push to `main` (or a manual run from the Actions page), the Gitea
Actions deployment workflow automatically runs `npm run update:generated`,
which:
- Reads all reference HTML files from `reference/` and converts them to
  Markdown issue files in `web/data/issues/`.
- Regenerates `web/data/products.json` and the product-tree manifest.
- Rebuilds the rendered test fixtures.
- Runs the test suite before deploying the site.

You can also run these steps locally:
```bash
npm run update:generated   # regenerate all derived files
npm test                   # verify everything is correct
```

### process.html ###

The `web/process.html` page is a browser-based manual testing tool that was
used historically to convert issue tables. It is **no longer the recommended
path** for data updates, but it remains available for one-off experimentation
or debugging the HTML-to-Markdown conversion logic.

### Notes ###

Generated files (`web/data/products.json`, `web/data/issues/`,
`test/fixtures/`) are intentionally committed so a clone of the repository
contains a ready-to-serve snapshot of the website without requiring Node.js or
a build step. They may lag behind the reference source files when contributors
do not regenerate them before committing. The reference source files are
canonical; the Gitea deployment workflow regenerates the derived files before
testing and publishing the site, so the hosted version does not depend on the
committed snapshot being current.

There is intentionally no automated scaping of Palo Alto's website, to avoid abuse of server resources.  Also releases are not that frequent.  A crawler to grab some data from the Common Crawl dataset was started but never really finished.

Some data was collected early on when the HTMLTable -> Markdown code was kind of bad, so the formatting of the issue write-up tends to be bad on those.  Mostly PAN-OS 10 and 11 stuff.

## External references ##

The `external_refs.json` file allows for links to be added to other websites that have information or discussion about certain issues.

I have vague ideas of something similar for CVEs.

## Automatic deployment

The deployment workflow in
[`.gitea/workflows/deploy.yml`](.gitea/workflows/deploy.yml) syncs the
contents of `web/` to
`firewallissues-deploy@<DEPLOY_HOST>:/var/www/html/firewallissues/web/`.

Before the first deployment:

1. Enable Actions for the Gitea repository and make sure an `ubuntu-latest`
   runner is available.
2. Create a dedicated `firewallissues-deploy` account and SSH key pair. Install
   the public key for that account and give it ownership of
   `/var/www/html/firewallissues/web/`.
3. Add these repository Actions secrets in Gitea:

   - `DEPLOY_HOST`: the web server hostname or IP address as reached by the
     Actions runner.
   - `DEPLOY_SSH_KEY`: the complete private key, including its BEGIN and END
     lines.
   - `DEPLOY_KNOWN_HOSTS`: the web server's trusted SSH host-key line. Generate
     it from a trusted network with `ssh-keyscan -H <DEPLOY_HOST>`, then verify
     its fingerprint before saving it.

The deploy account only needs write access to the site's `web` directory.
