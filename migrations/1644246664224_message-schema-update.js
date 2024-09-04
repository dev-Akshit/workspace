/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

    await pgm.sql(`ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_discussion_required BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS type SMALLINT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS liked_by VARCHAR(100)[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS unliked_by VARCHAR(100)[] DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS notify_user_ids VARCHAR(100)[] DEFAULT '{}'
    `);

};

exports.down = async (pgm) => {
};
