CREATE TABLE `meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`recipe_id` text NOT NULL,
	`servings` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_plan_entries_date_idx` ON `meal_plan_entries` (`date`);