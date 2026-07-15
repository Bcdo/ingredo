CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`purchased_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopping_items_status_idx` ON `shopping_items` (`status`,`normalized_name`);