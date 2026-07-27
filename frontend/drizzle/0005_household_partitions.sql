ALTER TABLE `meal_plan_entries` ADD `household_id` text;--> statement-breakpoint
CREATE INDEX `meal_plan_entries_household_idx` ON `meal_plan_entries` (`household_id`);--> statement-breakpoint
ALTER TABLE `recipes` ADD `household_id` text;--> statement-breakpoint
CREATE INDEX `recipes_household_idx` ON `recipes` (`household_id`);--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `household_id` text;--> statement-breakpoint
CREATE INDEX `shopping_items_household_idx` ON `shopping_items` (`household_id`);--> statement-breakpoint
UPDATE `recipes` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
UPDATE `meal_plan_entries` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
UPDATE `shopping_items` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');