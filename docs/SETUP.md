# Setting Glowfathom up to earn

The game is built and tested. What is left are the steps only a person can do:
open accounts, pass identity checks, accept terms and press "publish". There
are two sittings, a few weeks apart, and possibly a short third one.

**Be clear-eyed about the odds.** Research for this project found no verified
case of anything earning money with no audience and no ongoing work. The most
likely result in the first year is that nothing reaches PayPal: somewhere
between four chances in five and nine in ten. The realistic upside, about one
chance in twenty, is that CrazyGames promotes the game after its trial and it
earns something like £20 to £150 a month for a while. Treat this as a free
lottery ticket that costs you about two hours, not as income. Do not spend
money on it.

---

## Before anything else: play it for fifteen minutes

This is the single most useful thing you can do, and the only step that
improves the odds. The game has been tested by machines and by simulated
players, but no person has played it, and the portal judges it on how real
people behave.

Play it on a laptop and on your phone (or hand it to a friend), then write
down the answers to these five questions:

1. In the first minute, was there a moment you did not know what to do? Where?
2. What did you tap that did nothing, or did something you did not expect?
3. When did it first feel slow or boring, roughly how many minutes in?
4. Was anything hard to read or hard to hit, especially on the phone?
5. Would you open it again tomorrow? Why, or why not?

Paste the answers into a Claude session on this repository and ask for a
tuning pass. Then carry on below.

To play it: use the private preview link from the build session, or run
`npm ci && npm run dev` in the `game` folder and open the address it prints.

---

## Sitting 1 (about 45 minutes)

### 1. PayPal

Every route ends in PayPal.

- PayPal's UK terms say an account used mainly to sell must be a **Business
  account**. Converting a personal account is free. Do this first.
  ([PayPal UK user agreement](https://www.paypal.com/uk/legalhub/paypal/useragreement-full))
- Do not use PayPal's own **Donate button**: its UK help page reserves it for
  registered organisations. Ko-fi (later) is the safe way to take tips.
- New sellers can have early payments held for up to 21 days. That is normal.

### 2. CrazyGames

This is the only route with real upside: CrazyGames supplies the players and
shares advertising income every month. It is also the hardest to get into, so
it goes first, before the game is public anywhere else. That keeps an
exclusivity offer possible, which pays more.

1. Create a developer account at
   [developer.crazygames.com](https://developer.crazygames.com) and accept the
   terms.
2. Before submitting, search CrazyGames for "Glowfathom" and for deep-sea idle
   games. If a game with a confusingly similar name or look exists, stop and
   ask Claude to rename this one first.
3. Submit a new game:
   - Upload **`glowfathom-portal-v<version>.zip`**. Find it on GitHub under
     **Actions > CI > the latest successful run > storefront-zips**. (If the
     download has expired, press **Run workflow** on that page to make a
     fresh one.) This build has no adverts and no SDK, which is what the
     trial wants.
   - Covers: the `cover-*.png` files in `game/store/` that match the sizes
     asked for. There are a few designs; pick the one that looks best to you
     at thumbnail size. Video: `preview.mp4`.
   - Text, category and controls: from [LISTINGS.md](LISTINGS.md).
   - If asked whether AI was used, say yes and paste the disclosure.
4. Wait. After review the game gets a **Basic Launch**: one to three weeks in
   front of real players with adverts switched off. CrazyGames then decides,
   on play time, return visits, how many visitors start playing and how many
   click the cover, whether to promote it.

---

## Sitting 2 (two to five weeks later, about an hour)

### If CrazyGames invites the game to a Full Launch

1. Upload **`glowfathom-crazygames-v<version>.zip`** (same place as before).
   This build includes their advert SDK.
2. Run their QA tool on it. If it reports a problem, paste the message into a
   Claude session on this repository; the fix is usually small.
3. Complete payout onboarding (they use Tipalti). Choose **PayPal** if it is
   offered for the UK. This could not be confirmed in advance; if it is not
   offered, the fallback is a bank transfer. Earnings are paid monthly once
   they pass 100 euros, so small amounts can sit there for a while.
4. If they offer an exclusivity deal, it is probably worth taking: the other
   routes are expected to earn close to nothing. It means not publishing the
   game elsewhere until the period ends.

### If they ask for improvements, or decline

Copy the numbers from the developer dashboard (average play time, day-1
retention, conversion, click-through) into a Claude session on this repository
and ask for a tuning pass. A game that met some of the benchmarks can be
improved and put through another Basic Launch. This third touch is quite
likely; plan for it.

### Then, once any exclusivity has ended: the other storefronts

**itch.io** (about 30 minutes). Updates here publish themselves.

1. Create an account at [itch.io](https://itch.io).
2. **Settings > Publisher > Get started with payments.** Choose **"Collected by
   itch.io, paid later"**. In this mode itch.io is the seller, handles VAT for
   you, and pays out to PayPal on request once you have US$5. (The other mode,
   "Direct to you", lands in PayPal instantly but makes you responsible for
   VAT.) You will be asked for a short tax interview before the first payout.
3. **Dashboard > Create new project:** title `Glowfathom`, kind **HTML**,
   pricing **$0 or donate** with a suggested $3. Do not upload a file yet.
   Paste the description, tags and AI disclosure from
   [LISTINGS.md](LISTINGS.md), ticking every AI box that could apply. Add
   `cover-630x500.png` and the screenshots from `game/store/`. Turn comments
   off if you never want to answer anyone. Save as a draft.
4. Let the repository publish to it:
   - On itch.io: **Settings > API keys > Generate new API key.** Copy it.
   - On GitHub: **Settings > Secrets and variables > Actions.** Add a
     **secret** named `BUTLER_API_KEY` with that key, and a **variable** named
     `ITCH_TARGET` with `your-itch-username/glowfathom`.
   - **Actions > Publish > Run workflow.**
5. On the itch.io project's edit page, tick **"This file will be played in
   the browser"** on the new upload, set the embed to **1280 x 720**, enable
   the **fullscreen button** and **mobile friendly**, make it **Public**.
6. Edit `game/game.config.json` on GitHub and set `itchPageUrl` to the page's
   address, so the in-game "Support the developer" link works.

A new seller's first project that accepts money can wait in a review queue
before it appears in itch.io's search. That needs nothing from you.

**GitHub Pages and a Ko-fi tip link** (about 15 minutes, optional). In this
repository: **Settings > Pages > Source: GitHub Actions**. The next push
publishes a free copy at `https://<your-username>.github.io/DOMCON/`. Create a
page at [ko-fi.com](https://ko-fi.com), connect PayPal, check the fee setting
says 0% on one-off tips, and put its address in `tipUrl` in
`game/game.config.json`. GitHub allows donation links on Pages but not shops,
so keep this copy free.

**GameDistribution** (about 45 minutes, optional). Lower income per play but
an easier door. Create a developer account at
[gamedistribution.com](https://gamedistribution.com), register the game to get
its **Game ID**, put the ID in `gameDistributionId` in
`game/game.config.json`, wait for CI to rebuild, then upload
`glowfathom-gamedistribution-v<version>.zip` with the listing text and covers.
Their published terms disagree about the PayPal minimum (50 or 100 euros);
check what the dashboard says.

Do not add more portals than these. Earnings spread thinly across many sites
never reach any one site's payout minimum.

---

## After that

- **Nothing runs on a timer and nothing costs money.** The game is static
  files; the storefronts host it.
- **itch.io payouts are manual:** when the balance passes US$5, press
  "Request payout".
- **Changes publish themselves** to GitHub Pages and itch.io once those are
  switched on. CrazyGames and GameDistribution need a manual upload of the
  new zip.
- **Check your email a few times a year.** A portal can change its rules or
  its SDK and delist a game that is not updated; CrazyGames says it prefers
  games that are maintained. A fix is one Claude session and one upload.
- **Set a stop rule.** If nothing has come in three months after the trial,
  leave it running (it costs nothing) but put no more time into it.

## Tax (UK)

- Side income of up to £1,000 gross in a tax year needs no reporting. The
  government has announced a rise to £3,000 from 6 April 2027; that is not law
  yet. Tips count as income.
  ([GOV.UK](https://www.gov.uk/guidance/tax-free-allowances-on-property-and-trading-income))
- Above the allowance you must register for Self Assessment.
- Keep a simple note of what arrives and when. Platforms report seller income
  to HMRC.

This is a summary of public guidance, not tax advice.
