-- Migration number: 0009 	 2026-06-21T13:11:44.073Z
ALTER TABLE insights ADD COLUMN author TEXT;
ALTER TABLE insights ADD COLUMN report_date TEXT;
