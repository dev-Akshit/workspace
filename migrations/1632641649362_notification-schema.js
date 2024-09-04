/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS notifications(
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id VARCHAR(100) NOT NULL,
        workspace_id UUID NOT NULL,
        channel_id UUID NOT NULL,
        message_id UUID NOT NULL,
        type SMALLINT NOT NULL,
        reply_id UUID,
        is_read BOOLEAN DEFAULT false,
        created_by VARCHAR(100) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000
    );`);

	await pgm.sql(`CREATE INDEX notification_idx_user_id_created_at on notifications(user_id, channel_id, created_at);`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('notifications', { ifExists: true });
};
