ALTER TABLE `meal_plan_entries` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `meal_plan_entries` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `dirty` integer DEFAULT 1 NOT NULL;