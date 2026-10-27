#!/usr/bin/env bash
# Nightly object-storage backup (systemd timer forest-backup-objects).
#   public bucket  (product/review images, seed photos)          → included
#   private bucket (bot photos, staff uploads, exports)           → included
#   private replays/**  (rrweb session replays)                   → EXCLUDED (CLAUDE.md §6: replays
#     are kept 30 days only, consented and re-creatable by nobody; backing them up would extend
#     their retention past the purge job and multiply the bucket size for no recovery value)
# Copies go to the encrypted UZ backup bucket (rclone crypt). Changed/deleted objects are moved
# to history/<date>/ and kept BACKUP_REMOTE_DAYS (30) days, so an erased customer's photos leave
# the backups within 30 days (docs/14 data-subject requests).
#
# The live bucket: S3_ENDPOINT_FOR_BACKUP (default: the app's S3_ENDPOINT; on the VPS with the
# compose SeaweedFS use http://storage:8333 and RCLONE_NETWORK=forest_internal).
. "$(dirname "$0")/lib.sh"
trap_alert backup-objects

S3_ENDPOINT_FOR_BACKUP="${S3_ENDPOINT_FOR_BACKUP:-$(app_env S3_ENDPOINT)}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-$(app_env S3_ACCESS_KEY)}"
S3_SECRET_KEY="${S3_SECRET_KEY:-$(app_env S3_SECRET_KEY)}"
S3_REGION="${S3_REGION:-$(app_env S3_REGION)}"
S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-$(app_env S3_FORCE_PATH_STYLE)}"
export S3_ENDPOINT_FOR_BACKUP S3_ACCESS_KEY S3_SECRET_KEY S3_REGION S3_FORCE_PATH_STYLE
[[ -n "$S3_ENDPOINT_FOR_BACKUP" ]] || die "no S3 endpoint for the live buckets"
public="$(app_env S3_BUCKET_PUBLIC)"
private="$(app_env S3_BUCKET_PRIVATE)"
day="$(date -u +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

log "public bucket ${public:-forest-public}"
rclone_run sync "live:${public:-forest-public}" bcrypt:objects/public \
  --backup-dir "bcrypt:objects/history/${day}/public" --s3-no-check-bucket --fast-list
log "private bucket ${private:-forest-private} (without replays/)"
rclone_run sync "live:${private:-forest-private}" bcrypt:objects/private \
  --exclude 'replays/**' \
  --backup-dir "bcrypt:objects/history/${day}/private" --s3-no-check-bucket --fast-list
rclone_run delete bcrypt:objects/history --min-age "${BACKUP_REMOTE_DAYS:-30}d"
rclone_run rmdirs bcrypt:objects/history --leave-root
date -u +%Y-%m-%dT%H:%M:%SZ >"$BACKUP_DIR/OBJECTS_LAST_SUCCESS"
log "done"
