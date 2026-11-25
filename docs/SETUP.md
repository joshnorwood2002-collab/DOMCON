# Setting Glowfathom up to earn

The game is built and tested. What is left are the steps only a person can do:
open accounts, pass identity checks, accept terms and press "publish". There
are two sittings, a few weeks apart. After that nothing is needed unless a
storefront writes to you.

**Be clear-eyed about the odds.** Research for this project found no verified
case of anything earning money with no audience and no ongoing work. The most
likely result in the first year is that nothing reaches PayPal. The realistic
upside is a small monthly amount if CrazyGames promotes the game after its
trial. Treat this as a free lottery ticket that costs you about two hours, not
as income. Do not spend money on it.

---

## Before you start: PayPal

Every route below ends in PayPal.

- PayPal's UK terms say an account used mainly to sell must be a **Business
  account**. Converting a personal account is free. Do this first.
  ([PayPal UK user agreement](https://www.paypal.com/uk/legalhub/paypal/useragreement-full))
- Do not use PayPal's own **Donate button**: its UK help page reserves it for
  registered organisations. Ko-fi (below) is the safe way to take tips.
- New sellers can have early payments held for up to 21 days. That is normal.

---

## Sitting 1 (about an hour)

### 1. Turn on the free hosted copy (2 minutes, optional)

In this repository on GitHub: **Settings > Pages > Build and deployment >
Source: GitHub Actions**. The next push publishes the game at
`https://<your-username>.github.io/DOMCON/`.

GitHub allows donation links on Pages but not shops, so keep this copy free.
Skip this step if you would rather the game only existed on the storefronts.

### 2. itch.io (about 30 minutes)

itch.io is the one storefront where updates can publish themselves.

1. Create an account at [itch.io](https://itch.io).
2. **Settings > Publisher > Get started with payments.** Choose **"Collected by
   itch.io, paid later"**. In this mode itch.io is the seller, handles VAT for
   you, and pays out to PayPal on request once you have US$5. (The other mode,
   "Direct to you", lands in PayPal instantly but makes you responsible for
   VAT.) You will be asked for a short tax interview before the first payout.
3. **Dashboard > Create new project:**
   - Title: `Glowfathom`. Kind of project: **HTML**.
   - Pricing: **$0 or donate**, suggested donation $3.
   - Do not upload a file yet; step 4 does that.
   - Paste the description, tags and AI disclosure from
     [LISTINGS.md](LISTINGS.md). Tick every AI box that could apply.
   - Upload `cover-630x500.png` and the screenshots from `game/store/`.
   - Community: turn comments **off** if you never want to answer anyone.
   - Save as a **draft**.
4. Let the repository publish to itch.io by itself:
   - On itch.io: **Settings > API keys > Generate new API key.** Copy it.
   - On GitHub: **Settings > Secrets and variables > Actions.**
     Add a **secret** named `BUTLER_API_KEY` with that key.
     Add a **variable** named `ITCH_TARGET` with `your-itch-username/glowfathom`.
   - **Actions > Publish > Run workflow.** When it finishes, the build is on
     your itch.io page.
5. Back on the itch.io project's edit page, find the new upload and tick
   **"This file will be played in the browser"**. Set the embed to
   **1280 x 720**, enable the **fullscreen button** and **mobile friendly**.
   Change visibility to **Public** and save.
6. Tell the game where its page is, so the in-game "Support the developer"
   link works: edit `game/game.config.json` on GitHub and set `itchPageUrl` to
   your page's address, for example `https://your-name.itch.io/glowfathom`.

A new seller's first project that accepts money can wait in a review queue
before it appears in itch.io's search. That needs nothing from you.

### 3. Ko-fi tip page (10 minutes, optional)

Only needed if you did step 1. Create a page at [ko-fi.com](https://ko-fi.com),
connect PayPal, and check the fee setting says 0% on one-off tips. Put the
page's address in `tipUrl` in `game/game.config.json`. Tips then go straight
into your PayPal.

### 4. CrazyGames (about 30 minutes)

This is the only route with real upside: CrazyGames supplies the players and
shares advertising income every month. It is also the hardest to get into.

1. Create a developer account at
   [developer.crazygames.com](https://developer.crazygames.com) and accept the
   terms.
2. Submit a new game:
   - Upload **`glowfathom-portal-v<version>.zip`**. It is in the latest
     successful run under **Actions > CI > storefront-zips** on GitHub.
     This build has no adverts and no SDK, which is what the trial wants.
   - Covers: the three `cover-*.png` files in `game/store/` that match the
     sizes asked for. Video: `preview.mp4`.
   - Text, category and controls: from [LISTINGS.md](LISTINGS.md).
   - If asked whether AI was used, say yes and paste the disclosure.
3. Wait. After review the game gets a **Basic Launch**: one to three weeks in
   front of real players with adverts switched off. CrazyGames then decides,
   on play time, return visits and click-through, whether to promote it.

---

## Sitting 2 (two to five weeks later, about 45 minutes)

### If CrazyGames invites the game to a Full Launch

1. Upload **`glowfathom-crazygames-v<version>.zip`** (same place as before).
   This build includes their advert SDK.
2. Run their QA tool on it. If it reports a problem, paste the message into a
   new Claude session on this repository; the fix is usually small.
3. Complete payout onboarding (they use Tipalti). Choose **PayPal** if it is
   offered for the UK; if it is not, the fallback is a bank transfer.
   Earnings are paid monthly once they pass 100 euros.
4. If they offer an exclusivity deal, read it carefully: it would mean
   taking the game off itch.io and GitHub Pages for the period.

### If they decline, or once any exclusivity has ended: GameDistribution (optional)

Lower income per play, but an easier door.

1. Create a developer account at
   [gamedistribution.com](https://gamedistribution.com) and register the game
   to get its **Game ID**.
2. Put that ID in `gameDistributionId` in `game/game.config.json`. The next
   CI run rebuilds the zip with it.
3. Upload **`glowfathom-gamedistribution-v<version>.zip`** with the listing
   text and covers, and enter PayPal as the payment method (their minimum is
   50 euros by PayPal).

---

## After that

- **Nothing runs on a timer and nothing costs money.** The game is static
  files; the storefronts host it.
- **itch.io payouts are manual:** when the balance passes US$5, press
  "Request payout".
- **Changes publish themselves.** Any change pushed to this repository is
  tested, rebuilt, and sent to GitHub Pages and itch.io automatically.
  CrazyGames and GameDistribution need a manual upload of the new zip.
- **Check your email a few times a year.** A portal can change its rules or
  its SDK and delist a game that is not updated. A fix is one Claude session
  and one upload.
- **Set a stop rule.** If nothing has come in after three months, leave it
  running (it costs nothing) but put no more time into it.

## Tax (UK)

- Side income of up to £1,000 gross in a tax year needs no reporting. The
  government has announced a rise to £3,000 from 6 April 2027; that is not law
  yet. Tips count as income.
  ([GOV.UK](https://www.gov.uk/guidance/tax-free-allowances-on-property-and-trading-income))
- Above the allowance you must register for Self Assessment.
- Keep a simple note of what arrives and when. Platforms report seller income
  to HMRC.

This is a summary of public guidance, not tax advice.
