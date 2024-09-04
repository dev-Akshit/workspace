/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

    await pgm.sql(`ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS state SMALLINT DEFAULT 1
    `);
    
    await pgm.sql(`ALTER TABLE channels
        ADD COLUMN IF NOT EXISTS state SMALLINT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS pinned_message_id UUID DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS pinned_by VARCHAR(100) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS write_permission_type SMALLINT DEFAULT 1
    `);
};

exports.down = async (pgm) => {
};
