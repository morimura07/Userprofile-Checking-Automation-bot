# Discord Profile Finder

Chrome extension that scans the Discord channel member list and finds users whose profiles mention **CEO**, **Founder**, **CO-Founder**, **Project Manager**, **CTO**, or **Looking for Developer**.

## Setup

1. Open Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`Discord Bot`).
4. Keep the extension enabled.

## How to use

1. Open [Discord](https://discord.com) in the same browser and go to any **server channel** where the **right-hand member list** is visible.
2. Click the **Discord Profile Finder** extension icon in the toolbar.
3. Click **Search User Profiles**. The extension will click through each member, open their profile, and check for the keywords above.
4. When it finishes, the popup shows **Searched / Total / Found**.
5. Click **View Results** to open a new tab with a table of all matches.
6. In the results table, click a row to **copy that user’s username (ID)** to the clipboard. A “Copied to clipboard” toast will appear.

## Results page

- **Display Name** – name shown in the member list.
- **Username (ID)** – Discord username/handle (click row to copy).
- **Role** – matched keyword (e.g. CEO, Founder, CTO).
- **Profile** – short 1–2 line snippet from their profile.

The results page uses a dark theme consistent with Discord.

## Notes

- Run the search only on a channel view where the member list is visible.
- If the popup says “Reload the Discord tab and try again”, refresh the Discord tab and run the search again.
- The extension only reads profile text and does not send data anywhere except Chrome’s local storage for the results table.
