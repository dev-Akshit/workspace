module.exports = {
    tableName: 'notifications',
    columnName: {
        'id': 'id',
        'workspace_id': 'workspace_id',
        'channel_id': 'channel_id',
        'user_id': 'user_id',
        'type' : 'type',
        'message_id': 'message_id',
        'reply_id': 'reply_id',
        'is_read': 'is_read',
        'total_unread_message_count': 'total_unread_message_count',
        'created_by': 'created_by',
        'created_at' : 'created_at',
        'updated_at' : 'updated_at',
    }
}