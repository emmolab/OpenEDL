ALTER TABLE `auth_users` ADD `theme` text DEFAULT 'signal' NOT NULL;--> statement-breakpoint
UPDATE `sources`
SET
  `name` = 'Emerging Threats Block IPs',
  `url` = 'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
  `status` = 'pending',
  `next_refresh_at` = CURRENT_TIMESTAMP,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `url` = 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt';
--> statement-breakpoint
INSERT INTO `sources` (
  `name`, `url`, `kind`, `type`, `format`, `enabled`, `cached_entries`,
  `entry_count`, `status`, `refresh_interval_minutes`, `next_refresh_at`
)
SELECT
  'Emerging Threats Block IPs',
  'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
  'remote', 'ip', 'auto', 1, '[]', 0, 'pending', 60, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM `edl_lists` WHERE `type` = 'ip')
  AND NOT EXISTS (
    SELECT 1 FROM `sources`
    WHERE `url` =
      'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt'
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `list_sources` (`list_id`, `source_id`, `role`)
SELECT
  COALESCE(
    (SELECT `id` FROM `edl_lists`
     WHERE `slug` = 'perimeter-blocklist' LIMIT 1),
    (SELECT `id` FROM `edl_lists`
     WHERE `type` = 'ip' ORDER BY `id` LIMIT 1)
  ),
  `sources`.`id`,
  'include'
FROM `sources`
WHERE `sources`.`url` =
  'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt'
  AND EXISTS (SELECT 1 FROM `edl_lists` WHERE `type` = 'ip');
