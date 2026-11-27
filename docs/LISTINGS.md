# Store listing text

Copy and paste from here when a storefront asks for it. Everything below is
accurate to the game as built; change it only if the game changes.

## The basics

| Field | Text |
|---|---|
| Title | Glowfathom |
| Subtitle / tagline | Deep Sea Idle |
| Genre / category | Clicker, Idle, Incremental (choose "Clicker" where only one is allowed) |
| Players | Single player |
| Input | Mouse or touch. Keyboard optional. |
| Orientation | Any. Landscape on desktop, portrait or landscape on mobile. |
| Languages | English |
| Age | Suitable for everyone. No violence, no chat, no purchases. |
| Saves | In the browser (and in the portal's own save service where there is one) |

## Short description (one line)

A calm deep-sea idle game: scan glowing creatures, build a fleet that works while you are away, and dive to the bottom of the trench.

## Full description

Glowfathom is an idle game about going down.

You pilot a small research sub. Tap the creatures that swim past to scan them,
spend what you learn on a fleet that keeps scanning while you are away, and
fill the survey bar to dive deeper. Five ocean zones wait below, from the
sunlit shallows to the hadal trench at 10,900 metres, and the further you go
the stranger the lights get.

- 45 species to discover and study, from Coral Darters to The Floor Warden
- 12 fleet craft, 50 research upgrades, and an Institute that makes every new expedition faster
- Glimmer shoals, sonar bursts and feeding frenzies for when you want to play actively
- Keeps earning while the tab is closed
- Saves in your browser. No sign-up, no purchases
- Plays with a mouse or a finger, on desktop and mobile

## How to play / controls

- Click or tap a creature to scan it. Bigger and rarer creatures take a few taps.
- Buy fleet craft and research in the panel. They earn lumens for you.
- When the survey bar is full, press DIVE (or Space) to go deeper.
- At the edge of each zone, build a stronger hull to carry on.
- When progress slows, open the Institute and publish your expedition: you start again from the surface with permanent bonuses.
- Keys: Space or Enter dives, 1-5 switch panel tabs, M mutes, Escape closes dialogs.

## Tags

idle, incremental, clicker, ocean, deep sea, underwater, submarine, relaxing, collecting, casual, mouse only, mobile friendly, singleplayer

## AI disclosure

Use this wherever a storefront asks about generative AI, and tick every box
that could apply (code, graphics, sound, text):

> Glowfathom's code, its procedural art, its synthesised sound and its text
> were produced with an AI assistant (Claude). No image or audio generation
> model was used: everything you see and hear is drawn or synthesised by the
> game's own code while it runs.

## Images and video

All of these are in `game/store/`. To download one from GitHub, open the file
there and press the download button above the picture.

| File | Use |
|---|---|
| `cover-1920x1080.png` | CrazyGames landscape cover; general banner |
| `cover-800x1200.png` | CrazyGames portrait cover |
| `cover-800x800.png` | CrazyGames square cover |
| `cover-630x500.png` | itch.io cover image |
| `screenshot-1.png` to `screenshot-5.png` | Screenshots for any store (1280x720), one per ocean zone |
| `preview-landscape.mp4` | CrazyGames landscape preview video (1920x1080) |
| `preview-portrait.mp4` | CrazyGames portrait preview video (1080x1620) |

They follow CrazyGames' rules, which are the strictest:

- Covers carry only the game's title: no borders, no other text, no logos.
- Videos are between 15 and 20 seconds, silent, open on the cover, show real
  play at normal speed, and have no mouse pointer or black bars.

Nothing here is a mock-up. The covers are drawn by the game's own renderer.
The screenshots and videos are the real game running, loaded with the state a
simulated player reaches at each depth, so every number shown is one a player
would see. `npm run store-assets` in the `game` folder remakes all of them
after a change to the game (it needs `ffmpeg` for the videos).
