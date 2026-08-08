# SQLite backup and maintenance

OpenEDL's Docker and standalone Node.js deployments can create consistent
SQLite backups while the application is running. Open **Maintenance** as an
administrator to create a backup immediately or configure automatic backups.

## Backup schedule

Automatic backups are disabled by default. Available schedules are daily,
weekly, and monthly. Times are entered in UTC, and the exact next run is shown
in the browser's local time. Weekly and monthly schedules use the weekday or
day of the month on which the schedule is saved.

Each backup is created with SQLite's online backup API and passes an integrity
check before it is retained. OpenEDL keeps the configured number of newest
backup files, from 1 to 104, and removes older OpenEDL-created backups only
after a new backup succeeds.

The default Docker paths are:

```text
Database: /data/openedl.sqlite
Backups:  /data/backups
```

Both paths are inside the persistent `openedl-data` volume. To write backups
to a separately mounted location, set this in `.env` and recreate the
container:

```dotenv
DATABASE_BACKUP_DIR=/path/to/mounted/backup-directory
```

Backups in the same Docker volume protect against database corruption and
operator mistakes, but not loss of the host or volume. Copy important backups
to separate storage and test restoration periodically.

## VACUUM schedule

VACUUM schedules are disabled by default. Select a daily, weekly, or monthly
cadence and a UTC run time under **Database compaction**. The built-in scheduler
checks for due work every five minutes, so maintenance normally begins within
five minutes after the configured time.

When a backup and VACUUM are due during the same scheduler check, OpenEDL
creates and verifies the backup before starting VACUUM. VACUUM can pause writes
and needs temporary free disk space, so schedule it outside busy periods.

## Restore a backup

Administrators can restore an OpenEDL-created backup under **Maintenance →
SQLite backups → Restore from backup**. Select a backup, review the confirmation
dialog, and start the restore. OpenEDL verifies the selected file and creates a
new pre-restore safety backup of the live database before replacing it. If the
replacement fails, OpenEDL automatically attempts to roll back to that safety
backup.

You can also choose **Restore uploaded file** to restore a `.sqlite`, `.sqlite3`,
or `.db` file from your computer. Uploads are streamed to the backup directory
rather than loaded into application memory, are limited to 1 GB, and must pass
SQLite integrity verification. A valid uploaded file is retained as a normal
OpenEDL backup before the protected restore begins.

Restoration replaces all application data and settings with the selected
snapshot. The page reloads afterward and may require you to sign in again. Run
restores during a quiet maintenance window because new database operations are
temporarily rejected while the file is replaced. Restore files are restricted
to OpenEDL-created `.sqlite` files in `DATABASE_BACKUP_DIR`; arbitrary server
paths cannot be supplied.

The original offline procedure remains a recovery option if the application
cannot start: stop OpenEDL, preserve the current database and its `-wal` and
`-shm` files, copy the selected backup into `DATABASE_PATH`, and restart the
application.

Cloudflare D1 does not expose a local SQLite file to the application. Use
Cloudflare's managed D1 backup, restore, and export tools instead.
