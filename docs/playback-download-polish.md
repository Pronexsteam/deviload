# Playback and download improvements in development

This package is being prepared together for the next release. It does not change the application version or the release workflows.

- Music volume uses a squared slider curve for finer control near silence. Existing saved volume remains the same physical output level; the displayed percentage reflects the new control position. Mute restores the previous nonzero level.
- Download settings show the audio languages and exact audio tracks reported by the source, plus manual and automatic subtitle languages. Language preferences travel with saved profiles, settings backups and subscriptions. Exact stream IDs and size estimates belong only to the checked link. An unavailable selected track is reported rather than silently replaced.
- Preflight shows known source bytes, queued bytes on the destination disk, a conservative working-space budget and the number of items with unknown size. It does not scan an entire remote playlist. Output sizes after conversion and live recording remain unknown.
- Devil Cut offers a lossless trim for one unmodified clip. It copies compatible original streams into a separate file and shows requested versus keyframe-aligned boundaries. Effects, extra audio and multi-clip timelines still use the normal rendered export. The saved file is checked before publication; cancellation removes the partial result.
- Playback reports contain bounded recent stage, error-category and timing information plus engine version/status. Track names, links, paths and account data are excluded. Reports are exported only on request and are never uploaded automatically.
- Local recommendations balance evidence across artists, account for collaborations and recent playback across radio batches, reserve room for unfamiliar artists and explain the observed reason for each personal recommendation. Muted playback, seeks, paused time and private listening do not add positive taste evidence. Likes, exclusions, modes and existing v1 profiles remain compatible. Manual queues are not reranked.

Recommendation candidates still come from the guest music catalog. These changes improve local selection; they do not reproduce YouTube's private server model or guarantee that every source track can play.
