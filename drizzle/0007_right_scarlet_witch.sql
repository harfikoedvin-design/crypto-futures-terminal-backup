CREATE TABLE `background_scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_key` text NOT NULL,
	`version` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`evidence_hash` text NOT NULL,
	`summary_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_scan_runs_cycle_key_unique` ON `background_scan_runs` (`cycle_key`);--> statement-breakpoint
CREATE INDEX `background_scan_runs_state_started_idx` ON `background_scan_runs` (`state`,`started_at`);