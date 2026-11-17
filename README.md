# Mark's 70th Birthday invitation

The invitation page for Mark's 70th: <https://james-debono.github.io/marks-70th/>

A plain HTML/CSS/JS page hosted free on GitHub Pages. RSVPs go to a private Google Sheet through a small Google Apps Script, which also emails guests a confirmation.

## How RSVPs work

1. A guest taps **Will attend** or **Will not attend**, enters a name for each person (plus dietary requirements if attending), and optionally an email address and a message.
2. `app.js` sends the reply to the Apps Script web app (the `RSVP_ENDPOINT` at the top of `app.js`).
3. The script (`apps-script/Code.gs`, pasted into the sheet under Extensions > Apps Script) adds one row per guest to the **RSVPs** tab and marks any earlier rows for the same names as `Replaced`, so a guest who changes their mind is only counted once.
4. If the guest gave an email address, they get a confirmation email sent from the Google account that deployed the script.

The sheet's other tabs:

- **Summary**: headcount, list of attending guests, dietary requirements, messages, and replies from names that aren't on the guest list.
- **Guest list**: paste invitees into column A (one per row) and column B shows who has replied.

## Changing things

| To change | Edit |
|---|---|
| Wording, date, venue, dress code on the page | `index.html` |
| Calendar entry | `event.ics` and the two calendar links in `index.html` (search for `calendar.google.com` and `outlook.live.com`) |
| Confirmation email text, sender name | `EVENT` and `SETTINGS` at the top of `apps-script/Code.gs` |
| Get an email for every RSVP | Set `notifyEmails` in `apps-script/Code.gs` |
| Stop confirmation emails | Set `sendConfirmationEmails: false` in `apps-script/Code.gs` |
| Card or background image | Replace the files in `assets/` (same names) |

After editing the script in Google, publish it again or the site keeps using the old version: **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The web app URL stays the same.

After editing files here, commit and push to `main`; GitHub Pages updates the live site within a minute or two. Bump the `?v=` number on `styles.css` and `app.js` in `index.html` so browsers fetch the new files.

## Preview locally

```bash
python -m http.server 8770 --directory .
```

Then open <http://localhost:8770>. RSVPs sent from the local preview go to the real sheet, so delete any test rows afterwards.
