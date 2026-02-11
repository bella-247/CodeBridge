# Troubleshooting

## Device flow errors

- Ensure CLIENT_ID is set in src/background/constants.js
- Reload the extension after editing
- Check background service worker logs in chrome://extensions

## No content script response

- Confirm the active tab is on a supported domain
- Reload the problem page and try Detect again
- If the popup was open during a reload, close and reopen it

## Upload conflicts

- Enable Overwrite in the popup if files already exist
- Or rename/delete files in the target repo

## Repository errors

- Ensure the branch exists
- Ensure the token has access to the repo

## Code extraction issues

- Try reloading the page and re-detecting
- Some platforms change editor implementations; extraction may need updates

## Codeforces submission fetch issues

- Codeforces loads accepted code on the submission page.
- When Detect runs on a problem page, Code Bridge prompts you to open your last accepted submission.
- You can enable "Don't ask again (Auto Redirect)" to open it automatically next time.
- You can also click the accepted submission ID in the Codeforces sidebar and open the popup there.
- If no accepted submission is found, submit an accepted solution first and retry.
