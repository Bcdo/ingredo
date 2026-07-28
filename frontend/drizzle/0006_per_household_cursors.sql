UPDATE `settings` SET `key` = 'sync_cursor.' || (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id') WHERE `key` = 'sync_cursor' AND EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('sync_cursor', 'sync_household_id');
