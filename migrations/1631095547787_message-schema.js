/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS messages(
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id UUID NOT NULL,
        channel_id UUID NOT NULL,
        content TEXT,
        attachments JSON[] DEFAULT '{}',
        mentions JSON[] DEFAULT '{}',
        replyIds UUID[] DEFAULT '{}',
        replyToParentId UUID DEFAULT NULL, 
        status SMALLINT DEFAULT 1,
        created_by VARCHAR(100) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        deleted_at BIGINT DEFAULT NULL,
        deleted_by VARCHAR(100) DEFAULT NULL
    );`);

	await pgm.sql(`CREATE INDEX message_idx_channel_id_created_at on messages(channel_id, created_at);`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('messages', { ifExists: true });
};
