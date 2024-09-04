/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`ALTER TABLE users
        ADD COLUMN IF NOT EXISTS last_active_workspace_id UUID DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS last_active_channel_id UUID DEFAULT NULL
    `);
};

exports.down = async (pgm) => {

};
