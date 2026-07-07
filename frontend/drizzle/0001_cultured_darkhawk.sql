CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `recipe_ingredients` ADD `scaling` text DEFAULT 'linear' NOT NULL;