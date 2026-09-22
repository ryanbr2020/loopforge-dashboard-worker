-- Add thumbnail and loop-ready fields to projects table
ALTER TABLE projects ADD COLUMN thumb_url TEXT;
ALTER TABLE projects ADD COLUMN loop_ready INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'pending';
