const { v4: uuidv4 } = require('uuid');
const postgreUtil = require('pg/lib/utils');

const constants = require('../lib/constants');
const {redisKeys} = constants;

const postgres = require("../config/postgres");
const {pool} = postgres;

const {workspaceNotificationSettingsModel} = require("../models");
const redisService = require('../services/redisService');


const updateWorkSpaceNotificationSettings = async (payload) => {
    /*
        payload = {
            workspaceId: UUID(String),
            userId: String,
            notificationSettingsObj: {
                1:{
                    unreadMessages:50,
                    frequency:10,
                    emailNotificationCheck:true,
                    smsNotificationCheck:false,
                    cqNotificationCheck:true,
                },
                2:{
                    unreadMessages:100,
                    frequency:86,
                    emailNotificationCheck:true,
                    smsNotificationCheck:true,
                    cqNotificationCheck:true,
                }
            }
        }
    */
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { workspaceId, userId, notificationSettingsObj = {}} = payload;

        if ( ! workspaceId )        throw new Error("WorkspaceId is null");
        if ( ! userId )             throw new Error("UserId is null");

        const rolesArr = Object.keys(notificationSettingsObj) || [];
        for (let index = 0; index < rolesArr.length; index++) {
            const userRole = rolesArr[index];
            const settingsObj = notificationSettingsObj[userRole];
            const unreadMessageCount = parseInt(settingsObj.unreadMessages) || 0;
            const notificationFrequency = parseInt(settingsObj.frequency) || 0;

            const notificationTypes = [];
            if (settingsObj.emailNotificationCheck)     notificationTypes.push(constants.workspaceNotificationType.emailNotificationType);
            if (settingsObj.smsNotificationCheck)       notificationTypes.push(constants.workspaceNotificationType.SMSNotificationType);
            if (settingsObj.cqNotificationCheck)        notificationTypes.push(constants.workspaceNotificationType.cqNotificationType);

            const q = `INSERT INTO ${workspaceNotificationSettingsModel.tableName} \
                ( \
                    ${workspaceNotificationSettingsModel.columnName.workspace_id}, \
                    ${workspaceNotificationSettingsModel.columnName.role}, \
                    ${workspaceNotificationSettingsModel.columnName.created_by}, \
                    ${workspaceNotificationSettingsModel.columnName.unread_message_count}, \
                    ${workspaceNotificationSettingsModel.columnName.notification_frequency_in_hrs}, \
                    ${workspaceNotificationSettingsModel.columnName.notification_types} \
                ) \
                VALUES \
                ( \
                    '${workspaceId}', \
                    ${parseInt(userRole)}, \
                    '${userId}', \
                    ${unreadMessageCount}, \
                    ${notificationFrequency}, \
                    '${postgreUtil.prepareValue(notificationTypes)}'
                ) \
                ON CONFLICT (${workspaceNotificationSettingsModel.columnName.workspace_id}, ${workspaceNotificationSettingsModel.columnName.role}) \
                DO UPDATE SET \
                    ${workspaceNotificationSettingsModel.columnName.unread_message_count} =  ${unreadMessageCount}, \
                    ${workspaceNotificationSettingsModel.columnName.notification_frequency_in_hrs} =  ${notificationFrequency}, \
                    ${workspaceNotificationSettingsModel.columnName.notification_types} =  '${postgreUtil.prepareValue(notificationTypes)}', \
                    ${workspaceNotificationSettingsModel.columnName.updated_at} =  EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000 \
                RETURNING ${workspaceNotificationSettingsModel.columnName.id} \
            `;
            let res = await client.query(q);
            const id = res && res.rows && res.rows[0] && res.rows[0].id;
            if ( ! id )     throw new Error("id not found in notification settings model");
            redisService.redis('sadd', redisKeys.activeWorkspaceIdsSet, workspaceId);
        }

        await client.query('COMMIT');
        await client.release();
        
        return {'msg': 'Successfully updated'};

    } catch (error) {
        await client.query('ROLLBACK');
        await client.release();
        console.log("Error in updateWorkSpaceNotificationSettings. Error = ", error);
        throw error;
    }
}

const listWorkSpaceNotificationSettings = async (payload) => {
    try {
        let { workspaceId } = payload;
        if ( ! workspaceId )             throw new Error("workspaceId is null");

        const q = `SELECT * \
            FROM ${workspaceNotificationSettingsModel.tableName} \
            WHERE ${workspaceNotificationSettingsModel.columnName.workspace_id} = '${workspaceId}'`;
        
        // console.log("q = ", q);
        const res1 = await pool.query(q);
        const notificationSettingsArr = ( res1 && res1.rows && res1.rows ) || [];
        return {notificationSettingsArr};
    } catch (error) {
        console.log("Error in listWorkSpaceNotificationSettings. Error = ", error);
        throw error;
    }
}

module.exports = {
    updateWorkSpaceNotificationSettings,
    listWorkSpaceNotificationSettings,
}