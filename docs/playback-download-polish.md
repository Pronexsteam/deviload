# Playback and download improvements in development

This package is being prepared together for the next release. It does not change the application version or the release workflows.

- Music volume uses a squared slider curve for finer control near silence. Existing saved volume remains the same physical output level; the displayed percentage reflects the new control position. Mute restores the previous nonzero level.
- Download settings show the audio languages and exact audio tracks reported by the source, plus manual and automatic subtitle languages. Language preferences travel with saved profiles, settings backups and subscriptions. Exact stream IDs and size estimates belong only to the checked link. An unavailable selected track is reported rather than silently replaced.
- Preflight shows known source bytes, queued bytes on the destination disk, a conservative working-space budget and the number of items with unknown size. It does not scan an entire remote playlist. Output sizes after conversion and live recording remain unknown.
- Devil Cut offers a lossless trim for one unmodified clip. It copies compatible original streams into a separate file and shows requested versus keyframe-aligned boundaries. Effects, extra audio and multi-clip timelines still use the normal rendered export. The saved file is checked before publication; cancellation removes the partial result.
- Playback reports contain bounded recent stage, error-category and timing information plus engine version/status. Track names, links, paths and account data are excluded. Reports are exported only on request and are never uploaded automatically.
- Local recommendations balance evidence across artists, account for collaborations and recent playback across radio batches, reserve room for unfamiliar artists and explain the observed reason for each personal recommendation. Muted playback, seeks, paused time and private listening do not add positive taste evidence. Likes, exclusions, modes and existing v1 profiles remain compatible. Manual queues are not reranked.

## Contextual recommendations

Starting a collection or mood/search selection gives radio a bounded set of representative tracks from that selection. The current track and another representative can drive continuation rather than always adding an unrelated global favorite. Candidate source and original rank contribute bounded evidence; this is not an inferred genre or acoustic model. Network fan-out stays bounded, and successful raw radio pools remain reusable.

Prepared radio candidates are ranked against the current mode, favorites, exclusions and session immediately before they enter automatic playback. Changing familiar/discovery mode does not replace or reorder a manual queue. Historical familiarity is separate from decaying positive interest, so a retained, qualified artist does not become a new discovery merely because their score faded.

Selecting another search result or queue item does not create a durable dislike. An early Next on an automatically recommended track adds temporary, exact-track fatigue; repeated distinct skips pause that track for 20 minutes, including when it remains liked. Qualified listening clears that temporary skip state. Explicit hidden songs and blocked artists still take precedence. Legacy negative evidence remains readable.

Only recommendation cards visible for at least half a second in a focused music view count toward temporary exposure rotation. Ignoring a card does not create a dislike. Failed sources receive a short availability pause, separate from taste, and manual retry remains available. This session state is bounded (40 context tracks, 500 impressions, 200 skip records and 200 availability records) and is not exported or persisted. Entering or leaving private mode clears it.

Imported playlists still provide a weak, opt-in cold-start prior. Undated imports retain an unknown last-played date; dated listening decays from its supplied date. Imported evidence uses available history slots and does not overwrite or evict existing learned taste, including negative evidence. Library likes, playlist membership and the existing 2 MiB profile limit are preserved.

Recommendation candidates still come from the guest music catalog. These changes improve local selection; they do not reproduce YouTube's private server model or guarantee that every source track can play.
