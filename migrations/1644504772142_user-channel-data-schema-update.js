/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

    await pgm.sql(`ALTER TABLE user_channel_data
        ADD COLUMN IF NOT EXISTS liked_message_ids UUID[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS unliked_message_ids UUID[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS contributor_score INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS read_permission BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS write_permission BOOLEAN DEFAULT true
    `);
};

exports.down = async (pgm) => {
};
