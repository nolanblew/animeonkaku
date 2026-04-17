# Dynamic Playlist Specs

This file is the short reference for how dynamic playlists are expected to behave in Anime Ongaku.

## Goal

Users can create filter-based playlists that populate from their synced library data and theme metadata.

Two creation modes exist:
- `Simple` for guided presets and section-based filters
- `Advanced` for nested logic using `AND`, `OR`, and `NOT`

Two save modes exist:
- `Auto-updating` re-evaluates on sync and scheduled refreshes
- `Snapshot` only updates when first created or manually refreshed

## Playlist Types

There are three playlist classes in the app:
- `Standard playlists`: fully manual
- `Smart playlists`: user-created dynamic playlists
- `Built-in auto playlists`: app-managed playlists such as `Liked Songs`, `Currently Watching`, and `Kitsu Library`

Rules:
- Standard playlists can be renamed and deleted
- Smart playlists can be deleted
- Built-in auto playlists cannot be deleted
- Smart playlists should still visually read as auto/smart playlists in the UI

## Entry Points

Library playlist creation uses one entry:
- `+ New Playlist`

That opens a submenu with:
- `Standard Playlist`
- `Smart Playlist`

The button should animate between a `+` and `-` state when expanded/collapsed.

## Simple Mode Rules

Simple mode compiles into one underlying filter tree.

Behavior:
- Filters from different sections combine with `AND`
- Multi-selects inside a section are `OR`, unless that section explicitly supports `Match ALL`
- Rating in simple mode uses one control with a `Mine / Average` source toggle
- Time filters support both `Aired` and `Watched`

Supported simple filters:
- Time period
- Season
- Genres
- Minimum rating
- Media type
- Watching status
- Theme type

Current supported value scope:
- Watching status: `Current`, `Completed`
- Theme type: `OP`, `ED`

## Advanced Mode Rules

Advanced mode is the power-user editor for the same filter model.

Behavior:
- Supports nested `AND`, `OR`, and `NOT`
- Groups can contain groups or attributes
- A group can be negated
- An attribute can also be negated directly
- Double and deeper negation is allowed
- Attributes are added in two steps: choose attribute type, then choose its value

UI rules:
- Same-level siblings should align consistently
- The layout should stay compact and phone-friendly
- The editor should block invalid saves instead of letting bad state reach persistence

Invalid advanced states:
- Empty root group
- Empty nested group

## Filter Semantics

Dynamic playlists operate on theme results, using anime/library metadata as needed.

Current supported filter categories:
- Genre
- Air year / year range
- Watched date / watched recency
- Season
- Media subtype
- Average rating
- User rating
- Watching status
- Theme type
- Artist
- Downloaded
- Liked
- Disliked
- Play count
- Played since

General semantics:
- Positive filters with missing source data do not match
- `NOT(...)` inverts that result normally
- Preview count should reflect the same logic used for saved playlists

## Sort Order Rules

Every dynamic playlist has a sort spec alongside its filter tree. Sort is a separate concept from filtering and must be treated as such in UI and storage.

Sort spec shape:
- An ordered list of up to 5 `SortKey` entries
- Each key is `(attribute, direction)` where direction is `ASC` or `DESC`
- Earlier keys dominate; later keys only break ties

Default sort:
- Applied to every newly-created dynamic playlist
- `Watched Date DESC`, then `Title ASC`
- An empty sort spec also falls through to the default comparator

Supported sort attributes (grouped by value kind):
- `String`: Title, Artist, Anime Title
- `Theme Type`: OP / IN / ED rank, then numeric sequence
- `Date`: Aired Date, Watched Date, Last Played
- `Number`: Average Rating, My Rating, Play Count
- `Boolean`: Liked, Downloaded
- `Random`: deterministic shuffle; direction is ignored

Invariants:
- Nulls always sort last, regardless of `ASC` / `DESC`
- `RANDOM` is deterministic per evaluation pass (seeded by `nowMillis`) so a single preview stays stable while refreshes reshuffle
- After all user keys apply, the evaluator still appends the existing default fallback so ties land in a predictable place
- The same comparator must run for live preview and for saved-playlist evaluation
- A sort attribute may appear at most once in the spec; the picker dims already-used attributes

Persistence:
- Sort spec serializes as its own JSON column on the dynamic playlist spec
- Missing or unreadable sort JSON decodes to the default sort (never crashes)
- Sort changes round-trip through create, edit, and refresh paths

UI:
- Sort editing lives on its own sub-screen reached from the Advanced builder
- Advanced builder shows a compact summary row of current sort keys as an entry point
- Direction labels are type-aware (`Newest first`, `A -> Z`, `Low -> High`, `Yes first`, `Shuffle`)
- Users can add, remove, reorder, and reset-to-default sort keys

## Sync And Refresh Rules

Smart playlists depend on synced metadata from Kitsu and local app data.

Rules:
- Genre/category data must populate on a normal sync; a full resync should not be required just to backfill genres
- Auto-updating smart playlists refresh on sync
- Snapshot smart playlists do not auto-refresh
- Snapshot playlists expose manual refresh

## Persistence Rules

Dynamic playlists persist their filter spec and evaluate from that spec.

Rules:
- Filter specs must serialize and deserialize safely for every supported node type
- Save/update failures must surface as UI errors, not crashes
- Preview should fail safely if a filter is invalid

## Preview And Save Rules

Before save:
- Show live preview count
- Show validation errors inline when the current draft is invalid
- Disable or block save when the draft is invalid

Save defaults:
- Blank smart playlist name falls back to `Smart Playlist`

## Regression Checklist

When changing this feature, verify:
- Creating a simple smart playlist works
- Creating an advanced smart playlist works
- `Liked`, `Disliked`, and `Downloaded` filters save without serialization crashes
- Negating a single attribute works
- Negating a group works
- Empty advanced groups cannot be saved
- Smart playlists can be deleted
- Built-in auto playlists still cannot be deleted
- A normal sync can populate missing genres/categories
- Preview results and saved playlist results stay aligned
- New smart playlists start on the default sort (`Watched Date DESC, Title ASC`)
- Sort keys round-trip through save, edit, and refresh without loss
- Nulls stay at the bottom of a sorted result in both `ASC` and `DESC`
- Legacy playlists saved before sort existed still load without crashing
