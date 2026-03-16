# firewallissues
An alternative view of issues documented by our favorite firewall vendor.

Feel free to host your own version, or use [the one I host](https://firewallissues.axvig.com/).

New versions are easily added using the process.html page
- Copy the issue table's HTML from the webpage using devtools.
- Fill out the process.html page's fields and paste in the table HTML.
- Download the Markdown file
- Fix up the products.json file manually or run `update_products_from_issues.py`.
- Submit a pull request.

There is intentionally no automated scaping, to avoid abuse of server resources.  Also releases are not that frequent.


Inspired by [Pixi888's](https://www.reddit.com/user/Pixi888/) creation [bugidsearch.com](https://bugidsearch.com/).