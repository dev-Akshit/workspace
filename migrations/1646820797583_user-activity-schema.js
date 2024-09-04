/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {

    await pgm.sql(`CREATE TABLE IF NOT EXISTS user_activities (
        id UUID DEFAULT uuid_generate_v4(),
        user_id VARCHAR(100) NOT NULL,
        workspace_id UUID NOT NULL,
        channel_id UUID,
        message_id UUID,
        reply_id UUID,
        type SMALLINT DEFAULT 1,
        created_at BIGINT DEFAULT  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000
    );`);

	await pgm.sql(`CREATE INDEX IF NOT EXISTS user_activities_idx_user_id_channel_id_created_at on user_activities(user_id, channel_id, created_at);`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('user_activities', { ifExists: true });
};
