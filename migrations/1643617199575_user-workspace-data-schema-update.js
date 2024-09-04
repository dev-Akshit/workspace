/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`ALTER TABLE user_workspace_data
        ADD COLUMN IF NOT EXISTS last_notification_sent_at BIGINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS notification_emails_sent_count BIGINT DEFAULT 0
    `);
};

exports.down = async (pgm) => {

};
