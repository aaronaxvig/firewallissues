# firewallissues
An alternative view of issues documented by our favorite firewall vendor.

Feel free to host your own version, or use [the one I host](https://firewallissues.axvig.com/).

Inspired by [Pixi888's](https://www.reddit.com/user/Pixi888/) creation [bugidsearch.com](https://bugidsearch.com/).

## Data updates ##
Known and addressed issues for newly released versions are easily added using the process.html page
- Copy the issue table's HTML from the webpage using devtools.
- Fill out the process.html page's fields and paste in the table HTML.
- Download the Markdown file and put it into the correct folder.
- Run `npm run update:generated` to update `products.json`, append new stable
  product-tree manifest slots, and regenerate rendered test fixtures.
- Submit a pull request.

There is intentionally no automated scaping of Palo Alto's website, to avoid abuse of server resources.  Also releases are not that frequent.  A crawler to grab some data from the Common Crawl dataset was started but never really finished.

Some data was collected early on when the HTMLTable -> Markdown code was kind of bad, so the formatting of the issue write-up tends to be bad on those.  Mostly PAN-OS 10 and 11 stuff.

## External references ##

The `external_refs.json` file allows for links to be added to other websites that have information or discussion about certain issues.

I have vague ideas of something similar for CVEs.

## Automatic deployment

Gitea Actions tests and publishes the website after every push to `main`. The
workflow in [`.gitea/workflows/deploy.yml`](.gitea/workflows/deploy.yml) syncs
the contents of `web/` to
`firewallissues-deploy@<DEPLOY_HOST>:/var/www/html/firewallissues/web/`.
It can also be run manually from the Actions page.

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
