const axios = require('axios');
const postgres = require("../config/postgres");
const {pool} = postgres;

const postgreUtil = require('pg/lib/utils');

const {notificationModel, workspaceModel, channelModel, userModel, workspaceNotificationSettingsModel, userChannelDataModel, userWorkspaceDataModel, messageModel} = require("../models");
const {userService, redisService} = require("../services");

const {constants, utils} = require("../lib");
const {redisKeys, redisLockKeys, userRoleType, workspaceNotificationType} = constants;

const {cqBackendUrl} = require("../config/configVars");

const countUnreadNotifications = async (payload) => {
    try {
        let { userId } = payload;
        if ( ! userId )             throw new Error("User Id is null");

        q = `SELECT COUNT(*) FROM ${notificationModel.tableName} \
            WHERE \
                ${notificationModel.columnName.user_id} = '${userId}' AND \
                ${notificationModel.columnName.created_at} > ( \
                    SELECT ${userModel.columnName.last_notification_seen} \
                    FROM ${userModel.tableName} \
                    WHERE ${userModel.columnName.id} = '${userId}' \
                ) \
        `
        //console.log("q1 = ",q);
        let res1 = await pool.query(q);
        let count = ( res1 && res1.rows && res1.rows[0] && res1.rows[0].count ) || 0;
        return count;

    } catch (error) {
        console.log("Error in countUnreadNotifications. Error = ", error);
        throw error;
    }
}

const listNotifications = async (payload) => {
    try {
        let { lastSeen, limit, userId } = payload;
        if ( ! userId )             throw new Error("User Id is null");

        limit = parseInt(limit) || constants.defaultNotificationCountLimit;
        lastSeen = parseInt(lastSeen) || Date.now();
        
        let q = `SELECT \
                ${notificationModel.tableName}.${notificationModel.columnName.id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.workspace_id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.channel_id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.user_id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.message_id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.reply_id}, \
                ${notificationModel.tableName}.${notificationModel.columnName.type}, \
		        ${notificationModel.tableName}.${notificationModel.columnName.created_at}, \
                ${notificationModel.tableName}.${notificationModel.columnName.updated_at}, \
                ${notificationModel.tableName}.${notificationModel.columnName.created_at}, \
                ${notificationModel.tableName}.${notificationModel.columnName.created_by}, \
                ${notificationModel.tableName}.${notificationModel.columnName.is_read}, \
                ${notificationModel.tableName}.${notificationModel.columnName.total_unread_message_count}, \
                ${workspaceModel.tableName}.${workspaceModel.columnName.name} AS workspace_name\
            FROM ${notificationModel.tableName} \
            JOIN ${workspaceModel.tableName} \
            ON ${notificationModel.tableName}.${notificationModel.columnName.workspace_id} = ${workspaceModel.tableName}.${workspaceModel.columnName.id} \
            WHERE \
                ${notificationModel.columnName.user_id} = '${userId}' AND \
                ${notificationModel.tableName}.${notificationModel.columnName.created_at} < ${lastSeen} \
            ORDER BY ${notificationModel.columnName.created_at} DESC \
            LIMIT ${limit}
        `
        //console.log("q1 = ",q);
        let res1 = await pool.query(q);
        let notificationsArr = ( res1 && res1.rows ) || [];
        let createdByIdsSet = new Set();
        let channelIdsSet = new Set();
        notificationsArr.map((obj) => {
            createdByIdsSet.add(obj.created_by);
            if (obj.channel_id) channelIdsSet.add(obj.channel_id);
        });

        userIdsArr = await userService.getUser({_id: {$in: [...createdByIdsSet]}}, {displayname: 1});
        userIdsObj = {};
        (userIdsArr || []).map(obj => userIdsObj[obj._id] = obj.displayname);

        let channelsObj = {};

        if ( channelIdsSet.size ) {
            q = `SELECT ${channelModel.columnName.id}, ${channelModel.columnName.name}, ${channelModel.columnName.type} \
                FROM ${channelModel.tableName} \
                WHERE ${channelModel.columnName.id} = ANY('${postgreUtil.prepareValue([...channelIdsSet])}'::UUID[]) \
            `;
            res1 = await pool.query(q);
            res1 = ( res1 && res1.rows ) || [];
            res1.map(obj => channelsObj[obj.id] = {'name': obj.name, 'type': obj.type});

        }

        notificationsArr.map(obj => {
            obj.creatorName = userIdsObj[obj.created_by] || "";
            if (channelsObj[obj.channel_id]) {
                obj.channel_name = channelsObj[obj.channel_id]['name'];
                obj.channel_type = channelsObj[obj.channel_id]['type'];
            }
        });

        return {notificationsArr};

    } catch (error) {
        console.log("Error in listNotifications. Error = ", error);
        throw error;
    }
}

const emitUserNotifications = async (payload) => {
    try {
        let {userIds = [], notificationObj} = payload;
        //if ( ! notificationObj )    throw new Error("NotificationObj is null");

        for (let index = 0; index < userIds.length; index++) {
            let userId = userIds[index];
            //notificationObj.userId = userId;
            let count = await countUnreadNotifications({userId});
            io.to(userId).emit('notificationsCount', {count});
        }
        return ;
    } catch (error) {
        console.log("Error in emitUserNotifications. Error = ", error);
        return ;
    }
}

const changeStatusToRead = async (payload) => {
    try {
        const { notificationId } = payload;
        if ( ! notificationId )    throw new Error("NotificationObj is null");

        let q = `UPDATE ${notificationModel.tableName} \
            SET ${notificationModel.columnName.is_read} = true \
            WHERE ${notificationModel.columnName.id} = '${notificationId}'\
        `
        //console.log("q = ",q);
        let res = await pool.query(q);
        return ;
    } catch (error) {
        console.log("Error in changeStatusToRead. Error = ", error);
        return ;
    }
}

const setNotificationLastSeen = async (payload) => {
    try {
        const { userId } = payload;
        if ( ! userId )    throw new Error("userId is null");

        let q = `UPDATE ${userModel.tableName} \
            SET ${userModel.columnName.last_notification_seen} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000 \
            WHERE ${userModel.columnName.id} = '${userId}'\
        `
        //console.log("q = ",q);
        let res = await pool.query(q);
        io.to(userId).emit('notificationsCount', {count: 0});
        return ;
    } catch (error) {
        console.log("Error in changeStatusToRead. Error = ", error);
        return ;
    }
}

const checkActiveWorkspacesForNotification = async () => {
    let q, res;
    try {
        const isLockAvailable = await utils.lockRedis(redisLockKeys.notificationKey);
        if ( ! isLockAvailable )    return ;

        // Pop a random workspace for activeWorkspaceIdsSet in redis
        const workspaceId = await redisService.redis('spop', redisKeys.activeWorkspaceIdsSet);
        if ( ! workspaceId ) {
            utils.unlockRedis(redisLockKeys.notificationKey);
            return ;
        }
        
        // get notification settings for that workspace
        q = `SELECT * \
            FROM ${workspaceNotificationSettingsModel.tableName} \
            WHERE ${workspaceNotificationSettingsModel.columnName.workspace_id} = '${workspaceId}' \
            `;
        res = await pool.query(q);
        const workspaceSettingsArr = ( res && res.rows ) || [];
        
        if ( workspaceSettingsArr.length == 0 ) {
            utils.unlockRedis(redisLockKeys.notificationKey);
            return ;
        }

        const workspaceSettingsObj = {};
        workspaceSettingsArr.map(settingObj => {
            workspaceSettingsObj[settingObj.role] = settingObj;
        })

        // Get userIds, channelIds of that workspace
        q = `SELECT ${channelModel.columnName.id}, ${channelModel.columnName.user_ids}, ${channelModel.columnName.name}, ${channelModel.columnName.type} \
            FROM ${channelModel.tableName} \
            WHERE \
                ${channelModel.columnName.id} = ANY(ARRAY( \
                    SELECT UNNEST(${userWorkspaceDataModel.columnName.channel_ids}) \
                    FROM ${userWorkspaceDataModel.tableName} \
                    WHERE ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' \
                )) AND \
                ${channelModel.columnName.deleted_at} IS NULL \
            `;
        
        res = await pool.query(q);
        let channelsObjArr = ( res && res.rows ) || [];

        let usersObj = {}
        let userIdsArr = [];
        let channelIdsArr = [];
        channelsObjArr.map(obj => {
            channelIdsArr.push(obj.id);
            (obj.user_ids || []).map(userId => {
                if ( ! usersObj[userId] )   usersObj[userId] = {channelsObj: {}};
                usersObj[userId].channelsObj[obj.id] = {name: obj.name, type: obj.type};
            })
        });
        userIdsArr = Object.keys(usersObj);

        if (userIdsArr.length == 0) {
            utils.unlockRedis(redisLockKeys.notificationKey);
            return ;
        }

        // get last seen of each user for every joined channel
        q = `SELECT \
                ${userChannelDataModel.columnName.user_id}, \
                ${userChannelDataModel.columnName.channel_id}, \
                ${userChannelDataModel.columnName.last_seen} \
            FROM ${userChannelDataModel.tableName} \
            WHERE ${userChannelDataModel.columnName.channel_id} = ANY('${postgreUtil.prepareValue(channelIdsArr)}'::UUID[]) \
            `;
        res = await pool.query(q);
        res = ( res && res.rows ) || [];

        res.map(obj => {
            let o = usersObj[obj.user_id] && usersObj[obj.user_id].channelsObj;
            if ( o && o[obj.channel_id] ) {
                o[obj.channel_id].last_seen = parseInt(obj.last_seen);
            }
        })
        
        // get last notification sent timestamp for each user of workspace
        q = `SELECT \
                ${userWorkspaceDataModel.columnName.user_id}, \
                ${userWorkspaceDataModel.columnName.last_notification_sent_at}, \
                ${userWorkspaceDataModel.columnName.notification_emails_sent_count} \
            FROM ${userWorkspaceDataModel.tableName} \
            WHERE ${userWorkspaceDataModel.columnName.workspace_id} = '${workspaceId}' \
        `;

        res = await pool.query(q);
        res = ( res && res.rows ) || [];

        res.map(obj => {
            if ( usersObj[obj.user_id] ) {
                usersObj[obj.user_id].last_notification_sent_at = parseInt(obj.last_notification_sent_at);
                usersObj[obj.user_id].notification_emails_sent_count = parseInt(obj.notification_emails_sent_count);
            }
        });
        
        // get role of every user
        let usersDetailsObjArr = await userService.getUser({_id: {$in: userIdsArr}}, {displayname: 1, role: 1, email: 1}) || [];
        usersDetailsObjArr.map(userObj => {
            let o = usersObj[userObj._id];
            o.displayname = userObj.displayname;
            o.role = userObj.role;
            o.email = userObj.email;
        })

        // get workspace name
        q = `SELECT ${workspaceModel.columnName.name} \
            FROM ${workspaceModel.tableName} \
            WHERE ${workspaceModel.columnName.id} = '${workspaceId}' \
            `;
        res = await pool.query(q);
        const workspaceName = ( res && res.rows && res.rows[0] && res.rows[0][workspaceModel.columnName.name] ) || '' ;

        // Upcoming notification timestamp for workspace
        let timestampForUpcomingNotification;

        // Final computations
        for (let index = 0; index < userIdsArr.length; index++) {
            const userId = userIdsArr[index];
            const userObj = usersObj[userId];
            const userRole = userObj.role || userRoleType.user;
            
            const channelsObj = userObj.channelsObj || {};
            const userChannelIds = Object.keys(channelsObj);
            if ( userChannelIds.length == 0 )   continue;

            const notificationSettingObj = workspaceSettingsObj[userRole];
            if ( ! notificationSettingObj )     continue;

            const {unread_message_count = 0, notification_frequency_in_hrs = 0, notification_types = []} = notificationSettingObj;
            if ( unread_message_count == 0 || notification_frequency_in_hrs == 0 || notification_types.length == 0 )    continue;

            let totalUnreadMessagesAfterLastNotification = 0;
            let totalUnreadMessages = 0;
            let totalUnreadPrivateMessages = 0;
            const lastTimeStamp = Date.now();

            let nextNotificationTime = new Date(lastTimeStamp);
            nextNotificationTime.setHours(nextNotificationTime.getHours() + notification_frequency_in_hrs);
            nextNotificationTime = nextNotificationTime.getTime();

            if ( ! timestampForUpcomingNotification || timestampForUpcomingNotification > nextNotificationTime ) {
                timestampForUpcomingNotification = nextNotificationTime;
            }

            if ( userObj.last_notification_sent_at ) {
                const diffFromLastNotification = ( Date.now() - userObj.last_notification_sent_at ) / 36e5;
                if ( diffFromLastNotification <= notification_frequency_in_hrs )    continue;
            }
            
            for (let i = 0; i < userChannelIds.length; i++) {
                const channelId = userChannelIds[i];
                const channelObj = channelsObj[channelId];

                let onlineUserIdsSet = await utils.getOnlineUserIdsSetInChannelRoom(channelId);
                if ( onlineUserIdsSet.has(userId) ) {
                    //console.log("User is currently online");
                    totalUnreadMessagesAfterLastNotification = 0;
                    totalUnreadMessages = 0;
                    break;
                }

                const messageStreamName = utils.getChannelMessageRedisStreamName(channelId);

                q = `SELECT COUNT(*) \
                    FROM ${messageModel.tableName} \
                    WHERE \
                        ${messageModel.columnName.channel_id} = '${channelId}' AND \
                        ${messageModel.columnName.created_at} > ${channelsObj[channelId].last_seen} AND \
                        ${messageModel.columnName.created_at} <= ${lastTimeStamp} AND \
                        ${messageModel.columnName.replyToParentId} IS NULL \
                `;
                res = await pool.query(q);
                channelObj.totalUnreadMessages = ( res && res.rows && res.rows[0] && parseInt(res.rows[0].count) ) || 0;

                let messagesArr = await redisService.redis('xrange', messageStreamName, channelObj.last_seen + 1, lastTimeStamp) || [];

                channelObj.totalUnreadMessages += messagesArr.length;
                channelObj.unreadMessagesAfterLastNotification = channelObj.totalUnreadMessages;
                if ( channelObj.type == constants.channelTypes.privateType )    totalUnreadPrivateMessages += channelObj.totalUnreadMessages;

                if ( userObj.last_notification_sent_at && channelsObj[channelId].last_seen < userObj.last_notification_sent_at ) {
                    q = `SELECT COUNT(*) \
                        FROM ${messageModel.tableName} \
                        WHERE \
                            ${messageModel.columnName.channel_id} = '${channelId}' AND \
                            ${messageModel.columnName.created_at} > ${userObj.last_notification_sent_at} AND \
                            ${messageModel.columnName.created_at} <= ${lastTimeStamp} AND \
                            ${messageModel.columnName.replyToParentId} IS NULL \
                        `;
                    res = await pool.query(q);
                    channelObj.unreadMessagesAfterLastNotification = ( res && res.rows && res.rows[0] && parseInt(res.rows[0].count) ) || 0;

                    messagesArr = await redisService.redis('xrange', messageStreamName, userObj.last_notification_sent_at + 1, lastTimeStamp) || [];
                    channelObj.unreadMessagesAfterLastNotification += messagesArr.length;
                }

                totalUnreadMessagesAfterLastNotification += channelObj.unreadMessagesAfterLastNotification;
                totalUnreadMessages += channelObj.totalUnreadMessages;
            }
            
            if ( totalUnreadMessagesAfterLastNotification >= unread_message_count ) {
                // Send Notification
                for (let j = 0; j < notification_types.length; j++) {
                    const curNotificationType = notification_types[j];
                    if ( curNotificationType == workspaceNotificationType.cqNotificationType ) {
                        q = `UPDATE ${notificationModel.tableName} \
                            SET \
                                ${notificationModel.columnName.total_unread_message_count} = ${totalUnreadMessages}, \
                                ${notificationModel.columnName.created_at} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000, \
                                ${notificationModel.columnName.updated_at} = EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000 \
                            WHERE \
                                ${notificationModel.columnName.user_id} = '${userId}' AND \
                                ${notificationModel.columnName.channel_id} IS NULL AND \
                                ${notificationModel.columnName.workspace_id} = '${workspaceId}' AND \
                                ${notificationModel.columnName.is_read} = false AND \
                                ${notificationModel.columnName.type} = ${constants.notificationTypes.unreadMessageType} \
                            RETURNING ${notificationModel.columnName.id} \
                        `;
                        res = await pool.query(q);
                        let notificationId = res && res.rows && res.rows.length && res.rows[0][notificationModel.columnName.id];

                        if ( ! notificationId ) {
                            q = `INSERT INTO ${notificationModel.tableName} \
                                ( \
                                    ${notificationModel.columnName.workspace_id}, \
                                    ${notificationModel.columnName.user_id}, \
                                    ${notificationModel.columnName.total_unread_message_count}, \
                                    ${notificationModel.columnName.type}, \
                                    ${notificationModel.columnName.created_by} \
                                ) \
                                VALUES \
                                ( \
                                    '${workspaceId}',\
                                    '${userId}',\
                                    ${totalUnreadMessages},\
                                    ${constants.notificationTypes.unreadMessageType},\
                                    '${constants.superAdminUserId}'\
                                ) \
                            `;
                            res = await pool.query(q);
                        }
                        emitUserNotifications({userIds:[userId]});
                    }
                    else if ( curNotificationType == workspaceNotificationType.emailNotificationType ) {
                        let emailObj = {
                            workspaceObj: {workspaceId, workspaceName},
                            userObj,
                            channelsObj,
                            totalUnreadMessages,
                            totalUnreadPrivateMessages,
                            accessKey: constants.workspaceBackendKey,
                        }
                        await axios.post(`${cqBackendUrl}${constants.cqBackendRoutes.sendUserNotificationEmail}`, emailObj);
                        userObj.notification_emails_sent_count = ( userObj.notification_emails_sent_count || 0 ) + 1;
                    }
                    else {
                        console.log(`Notification code is not supported yet. Notification Code = ${curNotificationType}`);
                    }
                }

                // Save timestamp of last notification send in userWorkspaceData
                q = `INSERT INTO ${userWorkspaceDataModel.tableName} \
                    ( \
                        ${userWorkspaceDataModel.columnName.workspace_id}, \
                        ${userWorkspaceDataModel.columnName.user_id}, \
                        ${userWorkspaceDataModel.columnName.channel_ids}, \
                        ${userWorkspaceDataModel.columnName.last_notification_sent_at}, \
                        ${userWorkspaceDataModel.columnName.notification_emails_sent_count}, \
                        ${userWorkspaceDataModel.columnName.created_by} \
                    ) \
                    VALUES \
                    ( \
                        '${workspaceId}',\
                        '${userId}',\
                        '${postgreUtil.prepareValue(userChannelIds)}',\
                        ${lastTimeStamp},\
                        ${userObj.notification_emails_sent_count || 0},\
                        '${constants.superAdminUserId}'\
                    ) \
                    ON CONFLICT \
                    ( \
                        ${userWorkspaceDataModel.columnName.workspace_id}, \
                        ${userWorkspaceDataModel.columnName.user_id} \
                    ) \
                    DO UPDATE SET \
                        ${userWorkspaceDataModel.columnName.last_notification_sent_at} = ${lastTimeStamp}, \
                        ${userWorkspaceDataModel.columnName.notification_emails_sent_count} = ${userObj.notification_emails_sent_count || 0} \
                    RETURNING \
                        ${userWorkspaceDataModel.columnName.last_notification_sent_at} \
                `
                res = await pool.query(q);
                let timeStamp = res && res.rows && res.rows[0] && res.rows[0][userWorkspaceDataModel.columnName.last_notification_sent_at];
                if ( ! timeStamp )  {
                    console.log(`Error in updating userWorkspaceData, UserId = ${userId}, WorkspaceId = ${workspaceId}`);
                    continue ;
                }
            }
        }

        if ( timestampForUpcomingNotification) {
            await redisService.redis('hset', redisKeys.workspacesTimestampHash, workspaceId, timestampForUpcomingNotification);
        }

        utils.unlockRedis(redisLockKeys.notificationKey);
        return ;

    } catch (error) {
        console.log("Error in checkActiveWorkspacesForNotification. Error = ", error);
        console.log("Query failed = ", q);
        utils.unlockRedis(redisLockKeys.notificationKey);
        return ;
    }
}

const checkWorkspacesTimestampHash = async () => {
    try {
        const isLockAvailable = await utils.lockRedis(redisLockKeys.upcomingWorkspaceNotificationKey);
        if ( ! isLockAvailable )    return ;

        let workspacesTimeStamps = await redisService.redis('hgetall', redisKeys.workspacesTimestampHash);
        const workspaceIdsArr = Object.keys(workspacesTimeStamps) || [];
        for (let index = 0; index < workspaceIdsArr.length; index++) {
            const workspaceId = workspaceIdsArr[index];
            const upcomingNotificationTimestamp = workspacesTimeStamps[workspaceId];
            if ( upcomingNotificationTimestamp <= Date.now() ) {
                redisService.redis('sadd', redisKeys.activeWorkspaceIdsSet, workspaceId);
                redisService.redis('hdel', redisKeys.workspacesTimestampHash, workspaceId);
            }
        }
        utils.unlockRedis(redisLockKeys.upcomingWorkspaceNotificationKey);
        return ;
    } catch (error) {
        console.log("Error , checkWorkspacesTimestampHash = ", error);
        utils.unlockRedis(redisLockKeys.upcomingWorkspaceNotificationKey);
        return ;
    }
}

const startNotificationIntervals = async () => {
    try {
        setInterval(checkWorkspacesTimestampHash, 1000 * 60);
        setInterval(checkActiveWorkspacesForNotification, 1000 * 30);
        return ;
    } catch (error) {
        console.log("Error in startNotificationIntervals. Error = ", error);
        throw error;
    }
}

module.exports = {
    countUnreadNotifications,
    listNotifications,
    emitUserNotifications,
    changeStatusToRead,
    setNotificationLastSeen,
    checkActiveWorkspacesForNotification,
    startNotificationIntervals,
}
