/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
    await pgm.sql(`CREATE TABLE IF NOT EXISTS workspace_notification_settings(
        id UUID DEFAULT uuid_generate_v4(),
        workspace_id UUID NOT NULL,
        role SMALLINT NOT NULL,
        unread_message_count INT DEFAULT 0,
        notification_frequency_in_hrs INT DEFAULT 0,
        notification_types SMALLINT[] DEFAULT '{1}',
        is_disabled BOOLEAN DEFAULT false,
        created_by VARCHAR(100) NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000,
        PRIMARY KEY(workspace_id, role)
    );`);

};

exports.down = async (pgm) => {
	await pgm.dropTable('workspace_notification_settings', { ifExists: true });
};
