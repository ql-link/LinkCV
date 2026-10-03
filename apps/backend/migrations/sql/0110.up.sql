-- Upgrade migration for 0110: simplify recording transcription tasks
-- Stop the old API/Worker before upgrading; revision preflight rejects active
-- tasks. Terminal drafts, ownership, source sessions and call identities stay.
ALTER TABLE dataset_transcription_tasks
    DROP CHECK ck_transcription_terminal_lease,
    DROP COLUMN lease_until,
    ADD CONSTRAINT ck_transcription_terminal_lease CHECK (
        status IN ('queued','submitting','transcribing') OR lease_token IS NULL
    );
