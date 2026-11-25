# Game Night Voter

A static page, hosted on GitHub Pages, listing the games we play. Everyone can give each game a 👍 (+1) or 👎 (−1), so the group can see what people want to play.

## Files
- `index.html`, `style.css`, `app.js`: the page
- `games.json`: the game list (`id`, `name`, `image`)
- `images/`: one picture per game (the current ones are placeholder art; drop in real photos with the same file names, or point `image` at a `.jpg`)
- `config.js`: Supabase URL and publishable key. If these are empty, votes are saved only on each device.
- `supabase/schema.sql`: table and functions for shared voting

## Adding a game
1. Put a picture in `images/` (a 4:3 shape looks best).
2. Add a line to `games.json` with a new unique `id`. Keep each `id` the same once it exists, because votes are stored against it.

## Voting rules
- One vote per game per device. Tap the same button again to take your vote back, or tap the other button to change it.
- Each device has its own random ID in localStorage. This is a light guard, not real security: clearing browser data or using another browser gives you a fresh vote.

## Shared votes (Supabase)
1. Run `supabase/schema.sql` in the project's SQL editor.
2. Put the project URL and publishable (anon) key in `config.js`. The key is meant to be public. The browser can only call the three voting functions, not edit the table directly.

## Publishing on GitHub Pages
Repo → Settings → Pages → Source: "Deploy from a branch" → choose the branch and `/ (root)`.

---

# Slide & Merge (`slide-merge/`)

A flick-and-merge game: swipe up to slide an item across a table; two of the same item merge into the next bigger one. Play at `/slide-merge/` on the Pages site.

- Two themes: Fruit (🫐 → 🍉) and Drinks (🧃 → 🍾), 11 sizes each
- Swipe to aim and flick (swipe speed sets power, swipe angle steers)
- Combos, score popups, merge ladder, best score, red danger line with game over
- Power-ups: Bomb, Upgrade, Shake, Swap (earn one every 1,500 points)
- Pause menu, sound and vibration toggles, auto-saved game with Continue
- Everything is in `slide-merge/game.js`; tune sizes, speeds and themes at the top of that file
