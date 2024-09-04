/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

	await pgm.sql(`ALTER TABLE notifications 
        ALTER channel_id DROP NOT NULL,
        ALTER message_id DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS total_unread_message_count BIGINT DEFAULT 0
    `);
};

exports.down = async (pgm) => {

};
